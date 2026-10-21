<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * The one place a direct claim rejects an inactive conductor.
 *
 * `TicketClaimService::claimNextResult()` guards the same flag inline as a
 * query-saving shortcut, before it ever reaches a specific ticket; a direct
 * claim of a specific ticket (`claim()`, reached from `TicketClaimResource`
 * on route `bb_core.ticket_claim`) has no such shortcut to take, so it
 * asserts here instead.
 */
final class ConductorActiveGuard {

  /**
   * Throws when the conductor is inactive.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the conductor's `active` flag is FALSE.
   */
  public static function assertActive(BbConductorInterface $conductor): void {
    if (!(bool) $conductor->get('active')->value) {
      throw new ClaimConflictException('claim_conflict: conductor is inactive.');
    }
  }

}
