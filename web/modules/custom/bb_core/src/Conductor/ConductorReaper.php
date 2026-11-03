<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Psr\Log\LoggerInterface;

/**
 * Marks stale conductors offline — the single authority for going offline.
 *
 * A conductor's liveness is expressed by its `status` plus `last_seen` /
 * `lease_expires_at`, never by deleting the entity. A running conductor renews
 * `lease_expires_at` on every heartbeat; when it stops (graceful drain, hard
 * kill, or crash) the heartbeat stops and the lease goes stale. This reaper —
 * run from cron — flips any non-offline conductor whose lease has expired to
 * `offline`, so a dead conductor reads offline/stale rather than missing. It
 * never deletes a conductor.
 */
final class ConductorReaper {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly LoggerInterface $logger,
  ) {
  }

  /**
   * Flips every non-offline conductor with an expired lease to offline.
   *
   * @return int
   *   The number of conductors marked offline.
   */
  public function reap(): int {
    $now = $this->time->getRequestTime();
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    // Non-offline conductors whose lease has expired. `lease_expires_at > 0`
    // excludes freshly registered conductors that have not heartbeat yet (no
    // lease set), so they are never falsely reaped.
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('status', 'offline', '<>')
      ->condition('lease_expires_at', 0, '>')
      ->condition('lease_expires_at', $now, '<')
      ->execute();
    if (!$ids) {
      return 0;
    }
    $count = 0;
    foreach ($storage->loadMultiple($ids) as $conductor) {
      if (!$conductor instanceof BbConductorInterface) {
        continue;
      }
      $conductor->setStatus('offline');
      $conductor->save();
      $count++;
      $this->logger->info('Conductor @conductor (@uuid) marked offline: lease expired.', [
        '@conductor' => $conductor->label(),
        '@uuid' => $conductor->uuid(),
      ]);
    }
    return $count;
  }

}
