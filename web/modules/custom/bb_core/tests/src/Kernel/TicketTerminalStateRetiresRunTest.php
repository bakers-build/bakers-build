<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket entering a terminal state retires its last run, event or not.
 *
 * The terminal edge (→ done / → cancelled) is the ONE edge with no follow-on
 * claim, so closure cannot ride retireSupersededRuns. Normally it rides the
 * post_transition event (TicketTransitionSubscriber). But that event only
 * fires when the state_machine resolves a transition
 * (StateItem::dispatchTransitionEvent → findTransition(original, new)). An
 * agent's raw `--state done` JSON:API/dropsh write — frequently `--no-validate`
 * — can land the ticket in a terminal state via an edge the workflow does not
 * define (e.g. feature coding → done; feature remains review-mandatory), so no
 * event fires and the last run would stay running/claimed forever. The
 * bb_ticket entity_update safety net closes it regardless, independent of
 * the transition event.
 *
 * Bug/chore may finish from coding (BB-354); feature still has no coding →
 * done edge, so these tests seed bb_feature for the undefined-edge path.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTerminalStateRetiresRunTest extends ClaimKernelTestBase {

  /**
   * A raw jump to done with no resolved transition still retires the run.
   */
  public function testTerminalJumpWithoutTransitionRetiresRun(): void {
    // Feature: coding → done is undefined (review is mandatory).
    $ticket = $this->seedAssignedTicket(state: 'coding', workflow: 'bb_feature');
    $run = $this->seedRun($ticket, stateAtStart: 'coding', state: 'running');
    $run->set('log', 'real transcript')->save();

    // Undefined edge: state_machine dispatches no post_transition event
    // (mirrors an agent's --state done --no-validate).
    $ticket->set('state', 'done')->save();

    self::assertSame('done', $this->reloadRun($run)->getRunState());
    self::assertSame('real transcript', $this->reloadRun($run)->readLog());
  }

  /**
   * Closing a non-terminal ticket cancels it and retires its open run.
   *
   * TicketClosure sets `state = cancelled` in entity preSave, which runs
   * before the state field's preSave, so state_machine dispatches `cancel`
   * and TicketTransitionSubscriber retires the run as for a normal cancel.
   */
  public function testClosingNonTerminalTicketRetiresOpenRun(): void {
    $ticket = $this->seedAssignedTicket(state: 'coding', workflow: 'bb_bug');
    $run = $this->seedRun($ticket, stateAtStart: 'coding', state: 'running');

    $ticket->set('closed', TRUE)->save();

    self::assertSame('done', $this->reloadRun($run)->getRunState());
    $reloaded = $this->reloadTicket($ticket);
    self::assertTrue($reloaded->isClosed());
    self::assertSame('cancelled', (string) $reloaded->get('state')->value);
    self::assertNotNull($reloaded->getClosedDate());
  }

  /**
   * A raw jump to cancelled with no resolved transition retires the run too.
   */
  public function testCancelledJumpWithoutTransitionRetiresRun(): void {
    $ticket = $this->seedAssignedTicket(state: 'review', workflow: 'bb_feature');
    $run = $this->seedRun($ticket, stateAtStart: 'coding', state: 'claimed');

    // The run's start-state is stale (coding), so a raw terminal write must
    // retire it. review → cancelled is defined here; the assertion is that any
    // non-current active run is closed when the ticket reaches a terminal
    // state.
    $ticket->set('state', 'cancelled')->save();

    self::assertSame('done', $this->reloadRun($run)->getRunState());
  }

}
