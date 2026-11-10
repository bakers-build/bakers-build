<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheTagsInvalidatorInterface;
use Drupal\Core\KeyValueStore\KeyValueFactoryInterface;
use Drupal\Core\KeyValueStore\KeyValueStoreInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Remembers when a member asked for a ticket's failed run to be retried.
 *
 * Runs are pull-based, so a retry cannot start one: it only lifts the
 * failed-run circuit breaker, which then counts the runs changed after this
 * time. The ticket's conductor claims it again on its next poll.
 */
final class TicketRetry {

  /**
   * The retry requests by ticket id.
   */
  private readonly KeyValueStoreInterface $store;

  public function __construct(
    KeyValueFactoryInterface $keyValueFactory,
    private readonly TimeInterface $time,
    private readonly CacheTagsInvalidatorInterface $cacheTagsInvalidator,
  ) {
    $this->store = $keyValueFactory->get('bb_core.run_retry');
  }

  /**
   * Records the retry request of the ticket, now.
   *
   * Invalidates the ticket's cache tags: the failing stall reason it lifts is
   * cached with them.
   */
  public function request(BbTicketInterface $ticket): void {
    $this->store->set((string) $ticket->id(), $this->time->getRequestTime());
    $this->cacheTagsInvalidator->invalidateTags($ticket->getCacheTagsToInvalidate());
  }

  /**
   * When a retry was last requested for the ticket, if ever.
   */
  public function requestedAt(BbTicketInterface $ticket): ?int {
    $at = $this->store->get((string) $ticket->id());
    return $at === NULL ? NULL : (int) $at;
  }

}
