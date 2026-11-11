<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\bb_core\Claim\FailedRunCircuitBreaker;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Restarts a ticket parked by the failed-run circuit breaker.
 *
 * The one rule the ticket page and the bakers_ticket_restart tool share: a
 * restart stamps `restarted_at` and `restarted_by`, after which the breaker
 * counts only newer runs. Runs themselves are never touched.
 */
final class ParkedTicketRelease {

  /**
   * Constructs a ParkedTicketRelease.
   */
  public function __construct(
    private readonly FailedRunCircuitBreaker $breaker,
    private readonly TimeInterface $time,
    private readonly AccountProxyInterface $currentUser,
  ) {
  }

  /**
   * Whether the breaker parks this open ticket.
   */
  public function isParked(BbTicketInterface $ticket): bool {
    return !$ticket->isClosed() && $this->breaker->isTripped($ticket);
  }

  /**
   * Whether the current user may restart the ticket now.
   */
  public function mayRestart(BbTicketInterface $ticket): bool {
    return $ticket->access('update', $this->currentUser) && $this->isParked($ticket);
  }

  /**
   * Stamps the restart on the ticket; the caller validates and saves.
   */
  public function release(BbTicketInterface $ticket): void {
    $ticket->set('restarted_at', $this->time->getRequestTime());
    $ticket->set('restarted_by', $this->currentUser->id());
  }

}
