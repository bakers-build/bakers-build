<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\state_machine\Event\WorkflowTransitionEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Retires the run of the state a ticket just left, on every transition.
 *
 * When a bb_ticket changes state — through any path that dispatches the
 * state-machine transition, including a plain JSON:API/dropsh `state` write —
 * the run that executed the PREVIOUS state has finished. So every
 * still-active run whose `state_at_start` no longer matches the new state is
 * set to `done` (see TicketClaimService::closeRunsForState), on terminal and
 * intermediate edges alike.
 *
 * closed/closed_date are set by BbTicket::preSave(), not here, so they also
 * hold for a raw state write that dispatches no event.
 */
final class TicketTransitionSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly TicketClaimService $ticketClaim,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // Group-level event: fires for every transition in the bb_ticket
    // workflow group (bb_work and bb_autopilot).
    return ['bb_ticket.post_transition' => 'onTransition'];
  }

  /**
   * Retires the previous-state run(s) after a bb_ticket transition.
   */
  public function onTransition(WorkflowTransitionEvent $event): void {
    $ticket = $event->getEntity();
    if ($ticket instanceof BbTicketInterface) {
      $this->ticketClaim->closeRunsForState($ticket);
    }
  }

}
