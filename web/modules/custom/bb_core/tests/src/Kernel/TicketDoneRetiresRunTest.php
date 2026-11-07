<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\RunLog\RunLogPolicy;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Ticket reaching done retires its last open run and closes the ticket.
 *
 * `done` is terminal, so BbTicket::preSave() (BB-451) closes it on the
 * same save that drives this transition — closing is no longer the
 * conductor's cleanup pass, it is a server-side projection of terminality.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketDoneRetiresRunTest extends ClaimKernelTestBase {

  /**
   * Ticket reaching done retires its last open run and closes.
   */
  public function testDoneRetiresLastRunAndClosesTicket(): void {
    $ticket = $this->seedAssignedTicket(state: 'review');
    $run = $this->seedRun($ticket, stateAtStart: 'review', state: 'running');
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $run->set('log', 'real transcript')->save();

    $ticket->set('state', 'done')->save();

    self::assertSame('done', $this->reloadRun($run)->getRunState());
    self::assertTrue($this->reloadTicket($ticket)->isClosed());
    self::assertNotNull($this->reloadTicket($ticket)->getClosedDate());
    self::assertSame('real transcript', $this->reloadRun($run)->readLog());
  }

}
