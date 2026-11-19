<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbRunInterface;
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
 * Lists the runs Restart runs offers on a machine, a conductor or a ticket.
 */
#[Tool(
  id: 'bakers_run_restartable',
  label: new TranslatableMarkup('List restartable runs'),
  description: new TranslatableMarkup('Lists the runs Restart runs would cancel, grouped by ticket: each open, unfrozen ticket’s claimed or running runs and its newest run when that failed. With machine_id or conductor: the runs on your machine or your machine’s conductor; another owner’s looks empty. With ticket: the ticket’s runs when you may restart it, else none. Cancel the chosen ones with bakers_run_cancel runs.'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'machine_id' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Machine ID'),
      description: new TranslatableMarkup('The machine_id of one of your machines. Give exactly one of machine_id, conductor or ticket.'),
      required: FALSE,
    ),
    'conductor' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Conductor'),
      description: new TranslatableMarkup('Conductor UUID. Give exactly one of machine_id, conductor or ticket.'),
      required: FALSE,
    ),
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID. Give exactly one of machine_id, conductor or ticket.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'tickets' => new ListOutputDefinition(
      label: new TranslatableMarkup('Tickets'),
      description: new TranslatableMarkup('The tickets with restartable runs, oldest run first.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One ticket and its restartable runs.'),
        property_definitions: [
          'ticket' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Identifier'),
            description: new TranslatableMarkup('The ticket identifier.'),
          ),
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The ticket UUID.'),
          ),
          'title' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Title'),
            description: new TranslatableMarkup('The ticket title.'),
          ),
          'runs' => new ListOutputDefinition(
            label: new TranslatableMarkup('Runs'),
            description: new TranslatableMarkup('The ticket’s restartable runs.'),
            item_definition: new MapOutputDefinition(
              label: new TranslatableMarkup('Run'),
              description: new TranslatableMarkup('One run.'),
              property_definitions: [
                'run' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Run'),
                  description: new TranslatableMarkup('The run UUID, as bakers_run_cancel runs takes it.'),
                ),
                'number' => new OutputDefinition(
                  data_type: 'integer',
                  label: new TranslatableMarkup('Number'),
                  description: new TranslatableMarkup('The run number.'),
                ),
                'state' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('State'),
                  description: new TranslatableMarkup('claimed, running or failed.'),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  ],
)]
final class RunRestartable extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $inputs = array_filter([
      'machine_id' => (string) ($values['machine_id'] ?? ''),
      'conductor' => (string) ($values['conductor'] ?? ''),
      'ticket' => (string) ($values['ticket'] ?? ''),
    ], static fn (string $value): bool => $value !== '');
    if (count($inputs) !== 1) {
      throw new \InvalidArgumentException('Give exactly one of machine_id, conductor or ticket.');
    }
    $runs = match (array_key_first($inputs)) {
      'machine_id' => $this->machineRuns($inputs['machine_id']),
      'conductor' => $this->conductorRuns($inputs['conductor']),
      default => $this->ticketRuns($inputs['ticket']),
    };
    $tickets = [];
    foreach (TicketInterventions::byTicket($runs) as $group) {
      $ticket = reset($group)->getTicket();
      assert($ticket instanceof BbTicketInterface);
      $tickets[] = [
        'ticket' => $ticket->getIdentifier(),
        'uuid' => (string) $ticket->uuid(),
        'title' => $ticket->getTitle(),
        'runs' => array_values(array_map(static fn (BbRunInterface $run): array => [
          'run' => (string) $run->uuid(),
          'number' => (int) $run->id(),
          'state' => $run->getRunState(),
        ], $group)),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('Restartable runs listed.'), ['tickets' => $tickets]);
  }

  /**
   * The covered runs of the caller's machine with this machine_id.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The runs keyed by id.
   */
  private function machineRuns(string $host_key): array {
    $storage = $this->entities()->getStorage('bb_machine');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $this->currentUser->id())
      ->condition('host_key', $host_key)
      ->range(0, 1)
      ->execute();
    $machine = $ids ? $storage->load(reset($ids)) : NULL;
    return $machine instanceof BbMachineInterface ? TicketInterventions::restartCoveredRuns($machine) : [];
  }

  /**
   * The covered runs of this conductor, when it is on the caller's machine.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The runs keyed by id.
   */
  private function conductorRuns(string $uuid): array {
    $conductors = $this->entities()->getStorage('bb_conductor')->loadByProperties(['uuid' => $uuid]);
    $conductor = reset($conductors);
    return $conductor instanceof BbConductorInterface && TicketInterventions::mayRestartRuns($conductor, $this->currentUser)
      ? TicketInterventions::restartCoveredRuns($conductor)
      : [];
  }

  /**
   * The ticket's restart runs, when the caller may restart it.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The runs keyed by id.
   */
  private function ticketRuns(string $input): array {
    $ticket = $this->readableTicket($input);
    return TicketInterventions::mayRestartTicket($ticket) ? TicketInterventions::ticketRestartRuns($ticket) : [];
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Machine, conductor and ticket access depend on the values.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
