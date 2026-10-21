<?php

declare(strict_types=1);

namespace Drupal\bb_activity\EventSubscriber;

use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_activity\Activity\ActivityTrigger;
use Drupal\bb_core\Claim\TicketClaimedEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Hands a claim to the kinds that listen to it, inside the claim transaction.
 *
 * A failing kind fails the claim, so a committed claim never lacks its row.
 */
final class ClaimActivitySubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly ActivityKindManager $kinds,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [TicketClaimedEvent::NAME => 'onClaim'];
  }

  /**
   * Asks the kinds listening to claims.
   */
  public function onClaim(TicketClaimedEvent $event): void {
    $this->kinds->trigger(ActivityTrigger::TICKET_CLAIMED, [
      'ticket' => $event->ticket,
      'run' => $event->run,
      'conductor' => $event->conductor,
    ]);
  }

}
