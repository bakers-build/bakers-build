<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

/**
 * Captures the authoritative budget observed while holding the machine lock.
 */
final class MachineCapacityException extends ClaimConflictException {

  /**
   * Constructs a capacity refusal.
   *
   * @param int $occupancy
   *   Counted runs at the admission check.
   * @param int $capacity
   *   The machine's admission limit.
   */
  public function __construct(
    public readonly int $occupancy,
    public readonly int $capacity,
  ) {
    parent::__construct('claim_conflict: machine at capacity');
  }

}
