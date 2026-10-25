<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\ClaimConflictException;
use PHPUnit\Framework\Attributes\Group;

/**
 * Claim retires a superseded run and allows state re-entry.
 *
 * @group bb_core
 */
#[Group('bb_core')]
final class ClaimRetireSupersededTest extends ClaimKernelTestBase {

  /**
   * Tests that a stale run is retired and a new claimed run is created.
   *
   * An active run whose state_at_start differs from the current ticket state
   * must be retired to 'done' and a new 'claimed' run created.
   */
  public function testActiveRunWithDifferentStateIsRetiredThenNewRunCreated(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    // Stale run: started when ticket was in 'plan', ticket is now 'working'.
    $stale = $this->seedRun($ticket, stateAtStart: 'plan', state: 'running');

    $run = $this->claimService->claim($ticket, $this->conductor);

    self::assertSame('done', $this->reloadRun($stale)->getRunState());
    self::assertSame('claimed', $run->getRunState());
    self::assertSame('working', (string) $run->get('state_at_start')->value);
  }

  /**
   * Tests that a same-state active run raises a ClaimConflictException.
   *
   * An active run whose state_at_start matches the current ticket state is a
   * genuine concurrent claim and must throw ClaimConflictException.
   */
  public function testActiveRunWithSameStateStillConflicts(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $this->seedRun($ticket, stateAtStart: 'working', state: 'running');

    $this->expectException(ClaimConflictException::class);
    $this->claimService->claim($ticket, $this->conductor);
  }

  /**
   * A same-state run with an EXPIRED lease must NOT block a new claim.
   *
   * A claimed-but-never-started zombie whose claim_expires_at has lapsed is
   * effectively dead. It must be treated as not-active: expired out of the way
   * so the ticket re-claims, rather than throwing claim_conflict forever.
   */
  public function testExpiredLeaseSameStateRunDoesNotBlockReclaim(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $now = $this->container->get('datetime.time')->getRequestTime();
    $zombie = $this->seedRun($ticket, stateAtStart: 'working', state: 'claimed', claimExpiresAt: $now - 10);

    $run = $this->claimService->claim($ticket, $this->conductor);

    self::assertSame('expired', $this->reloadRun($zombie)->getRunState());
    self::assertSame('claimed', $run->getRunState());
    self::assertSame('working', (string) $run->get('state_at_start')->value);
  }

  /**
   * A terminal (done) run for the same state must NOT block a new claim.
   *
   * State re-entry (e.g. working -> review -> working) must be possible; the
   * terminal-run guard from the old assertNoTerminalRunForCurrentState() is
   * intentionally removed.
   */
  public function testTerminalRunForSameStateDoesNotBlockReentry(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $this->seedRun($ticket, stateAtStart: 'working', state: 'done');

    $run = $this->claimService->claim($ticket, $this->conductor);

    self::assertSame('claimed', $run->getRunState());
  }

}
