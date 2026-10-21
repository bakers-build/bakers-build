<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * BB-469 D3/AC-4: coding can route back to diagnose without re-qualifying.
 *
 * Recovering from a missing or invalid diagnosis used to force `requalify`
 * (`coding → qualification`), dropping an intact qualification handoff to
 * recover a diagnosis alone. `to_diagnose` adds the missing edge; `requalify`
 * stays available for the case that genuinely needs it.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCodingRouteBackTest extends ClaimKernelTestBase {

  /**
   * AC-4: coding routes back to diagnose without re-qualifying the ticket.
   */
  public function testCodingCanRouteBackToDiagnose(): void {
    $ticket = $this->seedAssignedTicket(state: 'coding');

    $transitions = array_keys($ticket->getState()->getTransitions());
    $targets = [];
    foreach ($ticket->getState()->getTransitions() as $transition) {
      $targets[] = $transition->getToState()->getId();
    }

    self::assertContains(
      'diagnose',
      $targets,
      'coding must offer a route back to diagnose; available: ' . implode(', ', $transitions),
    );
  }

  /**
   * AC-4: the new route back to diagnose does not drop `requalify`.
   */
  public function testCodingStillOffersRequalify(): void {
    $ticket = $this->seedAssignedTicket(state: 'coding');

    $transitions = array_keys($ticket->getState()->getTransitions());

    self::assertContains(
      'requalify',
      $transitions,
      'the new to_diagnose edge must be additive, not a replacement for requalify.',
    );
  }

}
