<?php

declare(strict_types=1);

namespace Drupal\island\Entity;

use Drupal\Core\Config\Entity\ConfigEntityInterface;

/**
 * Defines an application configuration entity.
 */
interface AppInterface extends ConfigEntityInterface {

  /**
   * Returns the provider identifier.
   */
  public function getProviderId(): string;

  /**
   * Returns the profile used when no conditional profile matches.
   */
  public function getDefaultProfileId(): string;

}
