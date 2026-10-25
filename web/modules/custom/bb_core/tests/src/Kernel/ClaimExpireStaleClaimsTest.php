<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the claim-time reaping of claimed-but-never-started run zombies.
 *
 * A run created `claimed` whose agent never started lets its `claim_expires_at`
 * lapse. There is no cron: `claimNext` reaps such stale claims up front (flips
 * them to the terminal `expired` state), which frees the conductor's capacity
 * (`activeRunCount` counts only `[claimed,running]`) and re-opens the ticket —
 * a fresh run is minted on the same call. Only `claimed` runs are reaped: a
 * `running` run is genuinely live (no lease-renewal path exists).
 *
 * @group bb_core
 */
#[Group('bb_core')]
final class ClaimExpireStaleClaimsTest extends ClaimKernelTestBase {

  /**
   * A stale claimed run is expired and its ticket re-claimed via claimNext.
   */
  public function testClaimNextExpiresStaleClaimAndReclaims(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $now = $this->container->get('datetime.time')->getRequestTime();
    $zombie = $this->seedRun($ticket, stateAtStart: 'working', state: 'claimed', claimExpiresAt: $now - 10);

    $run = $this->claimService->claimNext($this->conductor);

    self::assertSame('expired', $this->reloadRun($zombie)->getRunState());
    self::assertNotNull($run);
    self::assertSame('claimed', $run->getRunState());
    self::assertNotSame((int) $zombie->id(), (int) $run->id());
  }

  /**
   * Stale claims across several of the conductor's tickets are all expired.
   */
  public function testClaimNextExpiresStaleClaimsAcrossTickets(): void {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $a = $this->seedAssignedTicket(state: 'working');
    $b = $this->seedAssignedTicket(state: 'review');
    $za = $this->seedRun($a, stateAtStart: 'working', state: 'claimed', claimExpiresAt: $now - 10);
    $zb = $this->seedRun($b, stateAtStart: 'review', state: 'claimed', claimExpiresAt: $now - 10);

    $this->claimService->claimNext($this->conductor);

    self::assertSame('expired', $this->reloadRun($za)->getRunState());
    self::assertSame('expired', $this->reloadRun($zb)->getRunState());
  }

  /**
   * A running run is never expired, even with a lapsed lease.
   */
  public function testClaimNextLeavesRunningRun(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $now = $this->container->get('datetime.time')->getRequestTime();
    $running = $this->seedRun($ticket, stateAtStart: 'working', state: 'running', claimExpiresAt: $now - 10);

    $run = $this->claimService->claimNext($this->conductor);

    self::assertSame('running', $this->reloadRun($running)->getRunState());
    // The live run still holds the single-active-run slot → nothing re-claimed.
    self::assertNull($run);
  }

  /**
   * A claimed run whose lease is still live is never expired.
   */
  public function testClaimNextLeavesLiveLeaseClaim(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $now = $this->container->get('datetime.time')->getRequestTime();
    $live = $this->seedRun($ticket, stateAtStart: 'working', state: 'claimed', claimExpiresAt: $now + 600);

    $run = $this->claimService->claimNext($this->conductor);

    self::assertSame('claimed', $this->reloadRun($live)->getRunState());
    self::assertNull($run);
  }

  /**
   * A claimed run with no lease set (0) is never reaped.
   */
  public function testClaimNextIgnoresClaimWithoutLease(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $noLease = $this->seedRun($ticket, stateAtStart: 'working', state: 'claimed', claimExpiresAt: 0);

    $this->claimService->claimNext($this->conductor);

    self::assertSame('claimed', $this->reloadRun($noLease)->getRunState());
  }

}
