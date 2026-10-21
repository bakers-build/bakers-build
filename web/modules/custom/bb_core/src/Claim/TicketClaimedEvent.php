<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Symfony\Contracts\EventDispatcher\Event;

/**
 * A conductor claimed a ticket and its run was minted.
 *
 * Dispatched inside the claim transaction, after the ticket was re-checked:
 * a subscriber that throws rolls the claim back.
 */
final class TicketClaimedEvent extends Event {

  public const NAME = 'bb_core.ticket_claimed';

  public function __construct(
    public readonly BbTicketInterface $ticket,
    public readonly BbRunInterface $run,
    public readonly BbConductorInterface $conductor,
  ) {}

}
