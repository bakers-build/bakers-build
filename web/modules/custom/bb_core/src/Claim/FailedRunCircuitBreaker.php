<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Parks a ticket that is hot-reclaim-looping on a persistently-failing setup.
 *
 * The failed-run re-claim circuit breaker: a ticket is parked
 * when its DEFAULT_RETRY_CAP most-recent runs are all `failed` AND the newest
 * of them changed within DEFAULT_RETRY_WINDOW_SECONDS. This complements the
 * conductor terminalising a dead run to `failed` at once — without a cap a
 * `failed` run frees the ticket immediately, so a broken setup would re-claim +
 * re-fail every tick. Self-healing: once the window elapses (the newest failed
 * run ages out) or a non-failed run appears among the most recent N, the ticket
 * is claimable again — no permanent human gate. A ticket with fewer than `cap`
 * runs, or a mixed recent set, is never parked.
 *
 * Split out of TicketClaimService so the claim service stays under the phpmd
 * class-complexity budget. The thresholds are fixed constants.
 */
final class FailedRunCircuitBreaker {

  public const DEFAULT_RETRY_CAP = 3;
  public const DEFAULT_RETRY_WINDOW_SECONDS = 7200;

  /**
   * Constructs a FailedRunCircuitBreaker.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager, used to query the ticket's runs.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   The time service, used to evaluate the retry window.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
  ) {
  }

  /**
   * Throws when the ticket is parked by the failed-run circuit breaker.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to check.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the ticket's recent runs trip the breaker within the window.
   */
  public function assertClaimable(BbTicketInterface $ticket): void {
    if ($this->isTripped($ticket)) {
      throw new ClaimConflictException('claim_conflict: ticket parked after repeated failed runs.');
    }
  }

  /**
   * Whether the ticket is parked by the failed-run circuit breaker.
   */
  public function isTripped(BbTicketInterface $ticket): bool {
    $cap = self::DEFAULT_RETRY_CAP;
    $window = self::DEFAULT_RETRY_WINDOW_SECONDS;
    $storage = $this->entityTypeManager->getStorage('bb_run');
    // The `cap` most-recent runs of this ticket, newest first.
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->sort('changed', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, $cap)
      ->execute();
    // Fewer than `cap` runs so far → not enough failures to trip the breaker.
    if (count($ids) < $cap) {
      return FALSE;
    }
    $newest_changed = 0;
    foreach ($storage->loadMultiple($ids) as $run) {
      // A non-failed run among the most recent `cap` → the ticket has made
      // progress, so it stays claimable.
      if (!$run instanceof BbRunInterface || $run->getRunState() !== 'failed') {
        return FALSE;
      }
      $changed = (int) $run->get('changed')->value;
      if ($changed > $newest_changed) {
        $newest_changed = $changed;
      }
    }
    // All `cap` most-recent runs failed: park only while the newest is still
    // inside the retry window; past it the ticket self-heals.
    return $newest_changed > $this->time->getRequestTime() - $window;
  }

}
