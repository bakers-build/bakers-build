<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the failed-run re-claim circuit breaker (BB-149, AC-4).
 *
 * A ticket is parked when its `failed_retry_cap` most-recent runs are all
 * `failed` and the newest changed within `failed_retry_window_seconds`; it
 * self-heals once the window elapses or a non-failed run appears. Defaults
 * (3 / 7200s) come from TicketClaimService constants, overridable via config.
 */
#[Group('bb_core')]
final class ClaimCircuitBreakerTest extends ClaimKernelTestBase {

  /**
   * Seeds a failed run whose `changed` timestamp is set to $changed.
   */
  private function seedFailedRun(BbTicketInterface $ticket, int $changed): BbRunInterface {
    $run = $this->seedRun($ticket, 'diagnose', 'failed');
    // `changed` is set to request-time on save; override it directly so the
    // test controls the circuit-breaker window without touching the clock.
    $this->container->get('database')->update('bb_run')
      ->fields(['changed' => $changed])
      ->condition('id', $run->id())
      ->execute();
    return $this->reloadRun($run);
  }

  /**
   * The current request time, for building relative `changed` timestamps.
   */
  private function now(): int {
    return $this->container->get('datetime.time')->getRequestTime();
  }

  /**
   * Cap consecutive failures inside the window → the ticket is parked.
   */
  public function testParkedAfterCapFailuresInsideWindow(): void {
    $ticket = $this->seedAssignedTicket('diagnose');
    for ($i = 0; $i < 3; $i++) {
      $this->seedFailedRun($ticket, $this->now() - 600);
    }
    $this->expectException(ClaimConflictException::class);
    $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
  }

  /**
   * Newest failure older than the window → the ticket is claimable again.
   */
  public function testClaimableWhenNewestFailurePastWindow(): void {
    $ticket = $this->seedAssignedTicket('diagnose');
    // All three failed, but the newest is > 7200s old (default window).
    for ($i = 0; $i < 3; $i++) {
      $this->seedFailedRun($ticket, $this->now() - 10800);
    }
    $run = $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    $this->assertSame('claimed', $run->getRunState());
  }

  /**
   * Fewer than cap failures → the ticket stays claimable.
   */
  public function testClaimableBelowCap(): void {
    $ticket = $this->seedAssignedTicket('diagnose');
    // Only two failed runs (cap is 3).
    $this->seedFailedRun($ticket, $this->now() - 300);
    $this->seedFailedRun($ticket, $this->now() - 300);
    $run = $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    $this->assertSame('claimed', $run->getRunState());
  }

  /**
   * A non-failed run among the most-recent cap → claimable (progress was made).
   */
  public function testClaimableWithMixedRecentRuns(): void {
    $ticket = $this->seedAssignedTicket('diagnose');
    // A done run, then two failures — the newest three are not all failed.
    $done = $this->seedRun($ticket, 'diagnose', 'done');
    $this->container->get('database')->update('bb_run')
      ->fields(['changed' => $this->now() - 200])
      ->condition('id', $done->id())
      ->execute();
    $this->seedFailedRun($ticket, $this->now() - 100);
    $this->seedFailedRun($ticket, $this->now() - 50);
    $run = $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    $this->assertSame('claimed', $run->getRunState());
  }

  /**
   * Raising the cap in config lifts the parking threshold.
   */
  public function testConfigOverrideRaisesCap(): void {
    $this->config('bb_core.settings')->set('failed_retry_cap', 5)->save();
    $ticket = $this->seedAssignedTicket('diagnose');
    // Three failures inside the window: below the raised cap of 5 → claimable.
    for ($i = 0; $i < 3; $i++) {
      $this->seedFailedRun($ticket, $this->now() - 600);
    }
    $run = $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    $this->assertSame('claimed', $run->getRunState());
  }

}
