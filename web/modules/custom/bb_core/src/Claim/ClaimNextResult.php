<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

use Drupal\bb_core\Entity\BbRunInterface;

/**
 * One claim attempt's run or observed admission refusal, without mutable state.
 */
final readonly class ClaimNextResult {

  /**
   * Constructs a claim result.
   *
   * @param \Drupal\bb_core\Entity\BbRunInterface|null $run
   *   The newly claimed run, when successful.
   * @param \Drupal\bb_core\Claim\MachineCapacityException|null $capacity
   *   The last observed full-budget refusal when no run was claimed.
   */
  public function __construct(
    public ?BbRunInterface $run = NULL,
    public ?MachineCapacityException $capacity = NULL,
  ) {
  }

}
