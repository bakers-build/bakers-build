<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

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
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Cancels a ticket's active runs under the rule of the Cancel run action.
 */
#[Tool(
  id: 'bakers_run_cancel',
  label: new TranslatableMarkup('Cancel a ticket’s active runs'),
  description: new TranslatableMarkup('Sets every claimed or running run of the ticket to cancelled and records the reason in its error log; the conductor then stops the agent. Refused, with no run changed, when the ticket has no active run or the caller may not cancel one of them.'),
  operation: ToolOperation::Write,
  destructive: TRUE,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
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
  ],
)]
final class RunCancel extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $this->readableTicket($values['ticket']);
    $runs = TicketInterventions::activeRuns($ticket, $this->entities());
    if ($runs === []) {
      throw new \InvalidArgumentException(sprintf('Ticket %s has no active run.', $values['ticket']));
    }
    // All or nothing: every run is checked before the first is cancelled.
    foreach ($runs as $run) {
      if (!TicketInterventions::mayCancelRun($run, $ticket)) {
        throw new \InvalidArgumentException(sprintf('You may not cancel run %s of ticket %s.', $run->uuid(), $values['ticket']));
      }
    }
    $note = sprintf('cancelled by %s: %s', $this->currentUser->getAccountName(), $values['reason']);
    foreach ($runs as $run) {
      TicketInterventions::cancelRun($run, $note);
    }
    return ExecutableResult::success(new TranslatableMarkup('Runs cancelled.'), [
      'runs' => array_values(array_map(static fn ($run): string => (string) $run->uuid(), $runs)),
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
