<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\ClaimConflictException;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests claim behavior across active-flag changes.
 */
#[Group('bb_core')]
final class ConductorActiveClaimTest extends ClaimKernelTestBase {

  /**
   * An inactive conductor receives no waiting work.
   */
  public function testInactiveConductorClaimsNothing(): void {
    $this->seedAssignedTicket();
    $this->conductor->set('active', FALSE)->save();

    self::assertNull($this->claimService->claimNextResult($this->conductor)->run);
  }

  /**
   * The direct claim endpoint is guarded too, not only claim-next (F11).
   *
   * `TicketClaimResource` (route `bb_core.ticket_claim`) reaches `claim()`
   * without ever calling `claimNextResult()`, so the guard has to be in
   * `assertEligible()` as well or an inactive conductor could still be
   * handed a run through that door.
   */
  public function testDirectClaimOfInactiveConductorIsRejected(): void {
    $ticket = $this->seedAssignedTicket();
    $this->conductor->set('active', FALSE)->save();

    $this->expectException(ClaimConflictException::class);
    $this->claimService->claim($ticket, $this->conductor);
  }

  /**
   * Re-activation permits new claims.
   */
  public function testReactivatedConductorClaimsAgain(): void {
    $this->conductor->set('active', FALSE)->save();
    $this->conductor->set('active', TRUE)->save();
    $this->seedAssignedTicket();

    self::assertNotNull($this->claimService->claimNextResult($this->conductor)->run);
  }

}
