<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * BB-469 D3/AC-4: working can route back to plan without re-qualifying.
 *
 * Recovering from a missing or invalid plan used to force `requalify`
 * (`working → qualification`), dropping an intact qualification handoff to
 * recover a plan alone. `to_plan` adds the missing edge; `requalify`
 * stays available for the case that genuinely needs it.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCodingRouteBackTest extends ClaimKernelTestBase {

  /**
   * AC-4: working routes back to plan without re-qualifying the ticket.
   */
  public function testWorkingCanRouteBackToPlan(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');

    $transitions = array_keys($ticket->getState()->getTransitions());
    $targets = [];
    foreach ($ticket->getState()->getTransitions() as $transition) {
      $targets[] = $transition->getToState()->getId();
    }

    self::assertContains(
      'plan',
      $targets,
      'working must offer a route back to plan; available: ' . implode(', ', $transitions),
    );
  }

  /**
   * AC-4: the route back to plan does not drop `requalify`.
   */
  public function testWorkingStillOffersRequalify(): void {
    $ticket = $this->seedAssignedTicket(state: 'working');

    $transitions = array_keys($ticket->getState()->getTransitions());

    self::assertContains(
      'requalify',
      $transitions,
      'the to_plan edge must be additive, not a replacement for requalify.',
    );
  }

}
