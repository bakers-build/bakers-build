<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\RunLog\RunLogPolicy;
use PHPUnit\Framework\Attributes\Group;

/**
 * Every ticket state transition retires the run of the state just left.
 *
 * A plain `state` write (as dropsh/JSON:API does) dispatches the state-machine
 * transition; TicketTransitionSubscriber then sets every active run whose
 * state_at_start no longer matches the new state to `done`.
 *
 * @group bb_core
 */
#[Group('bb_core')]
final class TicketTransitionClosesRunTest extends ClaimKernelTestBase {

  /**
   * An intermediate transition closes the prior-state run.
   */
  public function testTransitionClosesPriorStateRun(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $run = $this->seedRun($ticket, stateAtStart: 'working', state: 'running');
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $run->set('log', 'real transcript')->save();

    $ticket->set('state', 'review')->save();

    self::assertSame('done', $this->reloadRun($run)->getRunState());
    self::assertSame('real transcript', $this->reloadRun($run)->readLog());
  }

  /**
   * A run started in the NEW state is not retired (it is the current run).
   */
  public function testSameStateRunSurvives(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $run = $this->seedRun($ticket, stateAtStart: 'review', state: 'running');

    // plan→working→review path is not needed; move straight to review so the
    // run's start-state (review) equals the new ticket state.
    $ticket->set('state', 'review')->save();

    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * A non-state ticket save retires nothing (no transition dispatched).
   */
  public function testNonStateSaveRetiresNothing(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');
    $run = $this->seedRun($ticket, stateAtStart: 'working', state: 'running');

    $ticket->setTitle('renamed')->save();

    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

}
