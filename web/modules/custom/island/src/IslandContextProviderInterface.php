<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * Host seam: the one thing a module implements to own a set of islands.
 *
 * Supplies the enabled islands, their configuration and their data for the
 * current request. Host modules register one tagged service per host:
 *   my_module.task_host:
 *     class: Drupal\my_module\TaskHostProvider
 *     tags:
 *       - { name: island.context_provider }
 */
interface IslandContextProviderInterface {

  /**
   * The stable host id used in HTML ids and action URLs.
   */
  public function hostId(): string;

  /**
   * The enabled island plugin ids for this host.
   *
   * @return string[]
   *   Island plugin ids.
   */
  public function getIslandIds(): array;

  /**
   * Plugin configuration for one island instance.
   */
  public function getIslandConfiguration(string $island_id): array;

  /**
   * The data passed to IslandInterface::build() for one island.
   */
  public function getIslandData(string $island_id): array;

}
