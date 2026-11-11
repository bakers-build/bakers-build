<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Ticket\ParkedTicketRelease;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Restarts a ticket parked after repeated failed runs.
 */
#[Tool(
  id: 'bakers_ticket_restart',
  label: new TranslatableMarkup('Restart a parked ticket'),
  description: new TranslatableMarkup('Releases a ticket the failed-run circuit breaker parked (its 3 most recent runs failed, the newest within 2 hours), so the next conductor cycle can claim it. Every run and its error log stay; only runs after the restart count from then on. Records who restarted it and when. Refused when the caller may not update the ticket, and a conflict when the ticket is not parked.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
  ],
  output_definitions: [
    'ticket' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('The restarted ticket’s identifier.'),
    ),
    'restarted_at' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Restarted at'),
      description: new TranslatableMarkup('When the ticket was restarted, ISO 8601.'),
    ),
    'restarted_by' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Restarted by'),
      description: new TranslatableMarkup('The account name of who restarted it.'),
    ),
  ],
)]
final class TicketRestart extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $input = (string) $values['ticket'];
    $ticket = $this->readableTicket($input);
    if (!$ticket->access('update', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('You may not restart ticket %s.', $input));
    }
    $release = \Drupal::service(ParkedTicketRelease::class);
    if (!$release->isParked($ticket)) {
      throw new \InvalidArgumentException(sprintf('Conflict: ticket %s is not parked after repeated failed runs; nothing was restarted.', $input));
    }
    $release->release($ticket);
    $this->assertValid($ticket);
    $ticket->save();
    return ExecutableResult::success(new TranslatableMarkup('Ticket restarted.'), [
      'ticket' => $ticket->getIdentifier(),
      'restarted_at' => date('c', (int) $ticket->getRestartedAt()),
      'restarted_by' => $this->currentUser->getAccountName(),
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket access depends on the values; doExecute() checks it.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
