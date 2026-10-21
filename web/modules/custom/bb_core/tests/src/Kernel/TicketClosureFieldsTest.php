<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Wind-up fields on the bb_ticket entity.
 *
 * Closed + closed_date are the lifecycle pair; cleaned_up (BB-89) is the
 * distinct infra-teardown flag the conductor reaper drives.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketClosureFieldsTest extends ClaimKernelTestBase {

  /**
   * A freshly seeded ticket is not closed and has no closed date.
   */
  public function testTicketStartsUnclosed(): void {
    $ticket = $this->seedAssignedTicket(state: 'coding');
    self::assertFalse($ticket->isClosed());
    self::assertNull($ticket->getClosedDate());
  }

  /**
   * Persists the closed flag and date across a reload via markClosed().
   */
  public function testMarkClosedSetsFlagAndDate(): void {
    $ticket = $this->seedAssignedTicket(state: 'done');
    $ticket->markClosed(1_700_000_000)->save();
    $reloaded = $this->reloadTicket($ticket);
    self::assertTrue($reloaded->isClosed());
    self::assertSame(1_700_000_000, $reloaded->getClosedDate());
  }

  /**
   * Cleaned_up defaults FALSE and is independent of the closed lifecycle.
   */
  public function testTicketStartsUncleaned(): void {
    $ticket = $this->seedAssignedTicket(state: 'coding');
    self::assertFalse($ticket->isCleanedUp());
  }

  /**
   * Persists cleaned_up across a reload via markCleanedUp().
   *
   * The close lifecycle stays untouched — teardown is decoupled from close.
   */
  public function testMarkCleanedUpSetsFlagIndependentOfClose(): void {
    $ticket = $this->seedAssignedTicket(state: 'done');
    $ticket->markCleanedUp()->save();
    $reloaded = $this->reloadTicket($ticket);
    self::assertTrue($reloaded->isCleanedUp());
    // Teardown flag only — the close lifecycle is untouched.
    self::assertFalse($reloaded->isClosed());
  }

}
