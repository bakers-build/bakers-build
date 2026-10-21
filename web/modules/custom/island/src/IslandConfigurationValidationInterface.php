<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * Allows configured islands to report unavailable or invalid dependencies.
 */
interface IslandConfigurationValidationInterface {

  /**
   * Returns actionable configuration errors before a profile is saved.
   *
   * @return string[]
   *   Translated error messages, or an empty array for valid configuration.
   */
  public function configurationErrors(): array;

}
