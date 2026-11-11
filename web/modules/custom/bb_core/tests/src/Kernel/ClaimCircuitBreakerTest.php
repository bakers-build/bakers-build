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
 * A ticket is parked when its three most-recent runs are all
 * `failed` and the newest changed within two hours; it
 * self-heals once the window elapses or a non-failed run appears. The cap and
 * window (3 / 7200s) are FailedRunCircuitBreaker constants, not configuration.
 */
#[Group('bb_core')]
final class ClaimCircuitBreakerTest extends ClaimKernelTestBase {

  /**
   * Seeds a failed run whose `changed` (and `created`) is set to $changed.
   */
  private function seedFailedRun(BbTicketInterface $ticket, int $changed, ?int $created = NULL): BbRunInterface {
    $run = $this->seedRun($ticket, 'plan', 'failed');
    // `changed` is set to request-time on save; override it directly so the
    // test controls the circuit-breaker window without touching the clock.
    $this->container->get('database')->update('bb_run')
      ->fields(['changed' => $changed, 'created' => $created ?? $changed])
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
    $ticket = $this->seedAssignedTicket('plan');
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
    $ticket = $this->seedAssignedTicket('plan');
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
    $ticket = $this->seedAssignedTicket('plan');
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
    $ticket = $this->seedAssignedTicket('plan');
    // A done run, then two failures — the newest three are not all failed.
    $done = $this->seedRun($ticket, 'plan', 'done');
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
   * Restarts the ticket at $at, as the restart service would.
   */
  private function restart(BbTicketInterface $ticket, int $at): BbTicketInterface {
    $ticket = $this->reloadTicket($ticket);
    $ticket->set('restarted_at', $at)->save();
    return $this->reloadTicket($ticket);
  }

  /**
   * A restart releases a parked ticket and keeps its failed runs untouched.
   */
  public function testRestartReleasesParkedTicket(): void {
    $ticket = $this->seedAssignedTicket('plan');
    $runs = [];
    for ($i = 0; $i < 3; $i++) {
      $run = $this->seedFailedRun($ticket, $this->now() - 100);
      $run->setErrorLog('boom ' . $i)->save();
      $runs[] = $run->id();
    }
    $breaker = $this->container->get('bb_core.failed_run_circuit_breaker');
    $this->assertTrue($breaker->isTripped($this->reloadTicket($ticket)));

    $ticket = $this->restart($ticket, $this->now());
    $this->assertFalse($breaker->isTripped($ticket));
    $run = $this->claimService->claim($ticket, $this->conductor);
    $this->assertSame('claimed', $run->getRunState());

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache();
    foreach ($runs as $i => $id) {
      $old = $storage->load($id);
      $this->assertInstanceOf(BbRunInterface::class, $old);
      $this->assertSame('failed', $old->getRunState());
      $this->assertStringContainsString('boom ' . $i, (string) $old->getErrorLog());
    }
  }

  /**
   * Three new failures after a restart park the ticket again.
   */
  public function testThreeNewFailuresAfterRestartParkAgain(): void {
    $ticket = $this->seedAssignedTicket('plan');
    for ($i = 0; $i < 3; $i++) {
      $this->seedFailedRun($ticket, $this->now() - 100);
    }
    $ticket = $this->restart($ticket, $this->now() - 50);
    for ($i = 0; $i < 3; $i++) {
      $this->seedFailedRun($ticket, $this->now() - 10);
    }
    $this->expectException(ClaimConflictException::class);
    $this->expectExceptionMessage('claim_conflict: ticket parked after repeated failed runs.');
    $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
  }

  /**
   * Fewer than cap failures after a restart do not park, old ones aside.
   */
  public function testTwoNewFailuresAfterRestartDoNotPark(): void {
    $ticket = $this->seedAssignedTicket('plan');
    for ($i = 0; $i < 3; $i++) {
      $this->seedFailedRun($ticket, $this->now() - 100);
    }
    $ticket = $this->restart($ticket, $this->now() - 50);
    $this->seedFailedRun($ticket, $this->now() - 10);
    $this->seedFailedRun($ticket, $this->now() - 10);
    $breaker = $this->container->get('bb_core.failed_run_circuit_breaker');
    $this->assertFalse($breaker->isTripped($this->reloadTicket($ticket)));
  }

}
