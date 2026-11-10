<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Cancels a ticket's or a machine's active runs under the Cancel run rule.
 */
#[Tool(
  id: 'bakers_run_cancel',
  label: new TranslatableMarkup('Cancel active runs of a ticket or machine'),
  description: new TranslatableMarkup('Sets claimed or running runs to cancelled and records the reason in each run’s error log; the conductor then stops the agent. With ticket: every active run of that ticket, refused with no run changed when it has none or the caller may not cancel one of them. With machine_id: every active run of your machine’s conductors across projects that you may cancel, with one comment per affected ticket; none cancelled is no error.'),
  operation: ToolOperation::Write,
  destructive: TRUE,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID. Give this or machine_id.'),
      required: FALSE,
    ),
    'machine_id' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Machine ID'),
      description: new TranslatableMarkup('The machine_id of one of your machines (from ~/.bakers/machine.config.js). Give this or ticket.'),
      required: FALSE,
    ),
    'reason' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Reason'),
      description: new TranslatableMarkup('Why the run ends; appended to each run’s error log.'),
      constraints: ['NotBlank' => []],
    ),
  ],
  output_definitions: [
    'runs' => new ListOutputDefinition(
      label: new TranslatableMarkup('Runs'),
      description: new TranslatableMarkup('UUIDs of the cancelled runs.'),
      item_definition: new OutputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Run'),
        description: new TranslatableMarkup('A cancelled run’s UUID.'),
      ),
    ),
    'cancelled' => new ListOutputDefinition(
      label: new TranslatableMarkup('Cancelled'),
      description: new TranslatableMarkup('The cancelled runs with their tickets.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Cancelled run'),
        description: new TranslatableMarkup('One cancelled run.'),
        property_definitions: [
          'run' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Run'),
            description: new TranslatableMarkup('The run’s UUID.'),
          ),
          'ticket' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Ticket'),
            description: new TranslatableMarkup('The run’s ticket identifier.'),
          ),
        ],
      ),
    ),
  ],
)]
final class RunCancel extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket_input = (string) ($values['ticket'] ?? '');
    $machine_input = (string) ($values['machine_id'] ?? '');
    if (($ticket_input === '') === ($machine_input === '')) {
      throw new \InvalidArgumentException('Give exactly one of ticket or machine_id.');
    }
    $note = sprintf('cancelled by %s: %s', $this->currentUser->getAccountName(), $values['reason']);
    if ($machine_input !== '') {
      return $this->cancelByMachine($machine_input, $note);
    }
    $ticket = $this->readableTicket($ticket_input);
    $runs = TicketInterventions::activeRuns($ticket, $this->entities());
    if ($runs === []) {
      throw new \InvalidArgumentException(sprintf('Ticket %s has no active run.', $ticket_input));
    }
    // All or nothing: every run is checked before the first is cancelled.
    foreach ($runs as $run) {
      if (!TicketInterventions::mayCancelRun($run, $ticket)) {
        throw new \InvalidArgumentException(sprintf('You may not cancel run %s of ticket %s.', $run->uuid(), $ticket_input));
      }
    }
    $cancelled = [];
    foreach ($runs as $run) {
      TicketInterventions::cancelRun($run, $note);
      $cancelled[] = ['run' => (string) $run->uuid(), 'ticket' => $ticket->getIdentifier()];
    }
    return $this->result($cancelled);
  }

  /**
   * Cancels the active runs of the caller's machine that the caller may cancel.
   *
   * Runs the caller may not cancel are skipped. An unknown machine, another
   * owner's machine and a machine without active runs give the same result.
   */
  private function cancelByMachine(string $host_key, string $note): ExecutableResult {
    $storage = $this->entities()->getStorage('bb_machine');
    // A conductor acts as its owner, so it reaches only the owner's machines.
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $this->currentUser->id())
      ->condition('host_key', $host_key)
      ->range(0, 1)
      ->execute();
    $machine = $ids ? $storage->load(reset($ids)) : NULL;
    $runs = $machine instanceof BbMachineInterface ? TicketInterventions::activeMachineRuns($machine, $this->entities()) : [];
    $cancelled = [];
    $lines = [];
    foreach ($runs as $run) {
      $ticket = $this->entities()->getStorage('bb_ticket')->load($run->getTicketId());
      if (!$ticket instanceof BbTicketInterface || !TicketInterventions::mayCancelRun($run, $ticket)) {
        continue;
      }
      TicketInterventions::cancelRun($run, $note);
      $cancelled[] = ['run' => (string) $run->uuid(), 'ticket' => $ticket->getIdentifier()];
      $lines[$ticket->id()][] = sprintf('Run %s %s', $run->uuid(), $note);
    }
    // One trace per ticket; its state, labels and freeze stay as they are.
    foreach ($lines as $ticket_id => $ticket_lines) {
      $this->entities()->getStorage('bb_comment')->create([
        'ticket_id' => $ticket_id,
        'type' => 'comment',
        'body' => ['value' => implode("\n\n", $ticket_lines), 'format' => 'bb_rich'],
      ])->save();
    }
    return $this->result($cancelled);
  }

  /**
   * The success result for these cancelled runs.
   *
   * @param list<array{run: string, ticket: string}> $cancelled
   *   The cancelled runs with their ticket identifiers.
   */
  private function result(array $cancelled): ExecutableResult {
    $message = $cancelled === [] ? new TranslatableMarkup('No active run cancelled.') : new TranslatableMarkup('Runs cancelled.');
    return ExecutableResult::success($message, [
      'runs' => array_column($cancelled, 'run'),
      'cancelled' => $cancelled,
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket and run access depend on the values; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
