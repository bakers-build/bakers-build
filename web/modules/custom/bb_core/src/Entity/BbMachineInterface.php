<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build machine host-capacity entities.
 *
 * A machine is the control-plane object for one physical (or logical) host.
 * Concurrent-run capacity lives here, not on each conductor.
 */
interface BbMachineInterface extends BbContentEntityInterface {

  /**
   * Returns the human-readable name of this machine.
   */
  public function getName(): string;

  /**
   * Sets the human-readable name of this machine.
   */
  public function setName(string $name): static;

  /**
   * Returns the host identity stem (machine-context machine_id).
   */
  public function getHostKey(): string;

  /**
   * Sets the host identity stem.
   */
  public function setHostKey(string $host_key): static;

  /**
   * Returns the maximum concurrent runs allowed on this host.
   */
  public function getMaxParallel(): int;

  /**
   * Sets the maximum concurrent runs allowed on this host.
   */
  public function setMaxParallel(int $max_parallel): static;

  /**
   * Returns the aggregated current load of online conductors on this host.
   */
  public function getCurrentLoad(): int;

  /**
   * Sets the aggregated current load.
   */
  public function setCurrentLoad(int $current_load): static;

}
