<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * A placement that can drop the parts of its configuration a removal orphans.
 *
 * Lets IslandProfile::onDependencyRemoval() keep the profile instead of
 * deleting it with the removed module.
 */
interface IslandDependencyRemovalInterface {

  /**
   * Returns the configuration without the parts that depend on the removal.
   *
   * @param array<string, mixed> $configuration
   *   The stored placement configuration.
   * @param array<string, string[]> $dependencies
   *   The dependencies being removed, keyed by type (module, theme, config).
   *
   * @return array<string, mixed>|null
   *   The pruned configuration, or NULL when nothing depends on the removal.
   */
  public function withoutDependencies(array $configuration, array $dependencies): ?array;

}
