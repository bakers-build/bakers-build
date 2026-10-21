<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the bb_ticket.frozen base field (BB-302, AC-1).
 */
#[Group('bb_core')]
final class TicketFrozenFieldTest extends ClaimKernelTestBase {

  /**
   * A fresh ticket is not frozen, and the flag round-trips through storage.
   */
  public function testFrozenDefaultsToFalseAndRoundTrips(): void {
    $ticket = $this->seedAssignedTicket('coding');
    self::assertFalse($ticket->isFrozen(), 'A new ticket is not frozen.');
    self::assertNull($ticket->getFrozenAt(), 'A new ticket has no freeze stamp.');

    $ticket->setFrozen(TRUE)->save();
    $reloaded = $this->reloadTicket($ticket);
    self::assertTrue($reloaded->isFrozen(), 'frozen survives a save/reload.');
    $first = $reloaded->getFrozenAt();
    self::assertNotNull($first, 'Freezing stamps frozen_at.');

    $reloaded->save();
    self::assertSame(
      $first,
      $this->reloadTicket($reloaded)->getFrozenAt(),
      'A later save of an already-frozen ticket keeps the original stamp.',
    );

    $reloaded->setFrozen(FALSE)->save();
    $cleared = $this->reloadTicket($reloaded);
    self::assertFalse($cleared->isFrozen(), 'frozen clears again.');
    self::assertNull($cleared->getFrozenAt(), 'Unfreeze clears the stamp.');
  }

  /**
   * A raw frozen write still stamps, because JSON:API never calls setFrozen().
   */
  public function testFrozenWriteThroughTheFieldStampsFrozenAt(): void {
    $ticket = $this->seedAssignedTicket('coding');
    $ticket->set('frozen', TRUE)->save();
    $reloaded = $this->reloadTicket($ticket);
    self::assertTrue($reloaded->isFrozen());
    self::assertNotNull($reloaded->getFrozenAt());
  }

}
