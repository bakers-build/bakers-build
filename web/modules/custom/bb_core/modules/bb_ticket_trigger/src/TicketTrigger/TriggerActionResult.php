<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * What a target's action did: a note for the trigger row and its ticket.
 */
final class TriggerActionResult {

  public function __construct(
    public readonly string $message,
    public readonly ?BbTicketInterface $ticket,
  ) {}

}
