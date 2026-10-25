<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;

/**
 * Tests the inactive-conductor assignment constraint.
 */
#[Group('bb_core')]
final class ConductorActiveAssignmentTest extends ClaimKernelTestBase {

  /**
   * An inactive conductor cannot be newly assigned.
   */
  public function testAssigningInactiveConductorIsRejected(): void {
    $ticket = $this->seedAssignedTicket();
    $ticket->set('conductor_id', NULL)->save();
    $this->conductor->set('active', FALSE)->save();

    $ticket = $this->reloadTicket($ticket);
    $ticket->set('conductor_id', $this->conductor->id());

    $violations = $ticket->validate()->getByField('conductor_id');
    self::assertGreaterThan(0, $violations->count());
    $message = (string) $violations->get(0)->getMessage();
    self::assertStringContainsString('inactive', $message);
    self::assertStringContainsString((string) $this->conductor->label(), $message);
  }

  /**
   * An active conductor remains assignable.
   */
  public function testAssigningActiveConductorPasses(): void {
    $ticket = $this->seedAssignedTicket();
    self::assertCount(0, $ticket->validate()->getByField('conductor_id'));
  }

  /**
   * Existing inactive references remain writable.
   *
   * The ticket carries a run still in flight, so the deactivation reassigner
   * deliberately leaves it on the deactivated conductor (D1) — the shape the
   * approved refinement has to keep writable.
   */
  public function testUnchangedInactiveReferenceStillValidates(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'running');
    $this->conductor->set('active', FALSE)->save();
    $reloaded = $this->reloadTicket($ticket);
    self::assertSame((int) $this->conductor->id(), (int) $reloaded->get('conductor_id')->target_id);
    $reloaded->set('title', 'Still writable');

    self::assertCount(0, $reloaded->validate()->getByField('conductor_id'));
  }

}
