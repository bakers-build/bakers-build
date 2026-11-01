<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Pins that changing a ticket's conductor cancels the run left on the old one.
 */
#[Group('bb_core')]
final class TicketConductorChangeCancelsRunTest extends ClaimKernelTestBase {

  /**
   * Moving the ticket to another conductor cancels the old run; B claims it.
   */
  public function testReassignCancelsOldRunAndNewConductorClaims(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'running');
    $other = $this->otherConductor();

    $ticket = $this->reloadTicket($ticket);
    $ticket->setConductor($other)->save();

    $run = $this->reloadRun($run);
    self::assertSame('cancelled', $run->getRunState());
    self::assertStringContainsString('conductor reassigned', (string) $run->getErrorLog());
    $claimed = $this->claimService->claimNext($other);
    self::assertNotNull($claimed);
    self::assertSame((int) $ticket->id(), $claimed->getTicketId());
  }

  /**
   * Clearing the conductor cancels the active run too.
   */
  public function testClearingConductorCancelsRun(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'claimed');

    $this->reloadTicket($ticket)->setConductor(NULL)->save();

    self::assertSame('cancelled', $this->reloadRun($run)->getRunState());
  }

  /**
   * A save that keeps the conductor cancels nothing.
   */
  public function testSaveWithoutConductorChangeCancelsNothing(): void {
    $ticket = $this->seedAssignedTicket('plan');
    $run = $this->seedRun($ticket, 'plan', 'running');

    $this->reloadTicket($ticket)->setTitle('renamed')->save();

    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * A second conductor of the same owner on the same project.
   */
  private function otherConductor(): BbConductorInterface {
    $owner = $this->conductor->get('owner_user_id')->entity;
    assert($owner instanceof UserInterface);
    return $this->createConductor($owner, 'node-other', ['plan', 'working', 'review']);
  }

}
