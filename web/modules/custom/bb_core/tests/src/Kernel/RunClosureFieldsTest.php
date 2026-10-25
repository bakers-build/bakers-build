<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Closure pair (closed + closed_date) on the bb_run entity.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunClosureFieldsTest extends ClaimKernelTestBase {

  /**
   * A freshly seeded run is not closed and has no closed date.
   */
  public function testRunStartsUnclosed(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $run = $this->seedRun($ticket, stateAtStart: 'working', state: 'running');
    self::assertFalse($this->reloadRun($run)->isClosed());
    self::assertNull($this->reloadRun($run)->getClosedDate());
  }

  /**
   * Persists the closed flag and date across a reload via markClosed().
   */
  public function testMarkClosedSetsFlagAndDate(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $run = $this->seedRun($ticket, stateAtStart: 'working', state: 'done');
    $run->markClosed(1_700_000_000)->save();
    $reloaded = $this->reloadRun($run);
    self::assertTrue($reloaded->isClosed());
    self::assertSame(1_700_000_000, $reloaded->getClosedDate());
  }

  /**
   * The bb_run 'agent' base field (BB-144) round-trips across a reload.
   *
   * The conductor persists the chosen agent id here at dispatch so the
   * stateless finalize step can route footprint parsing to the agent that
   * actually ran.
   */
  public function testAgentFieldRoundTrips(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $run = $this->seedRun($ticket, stateAtStart: 'working', state: 'running');
    $run->set('agent', 'claude')->save();
    self::assertSame('claude', $this->reloadRun($run)->get('agent')->value);
  }

}
