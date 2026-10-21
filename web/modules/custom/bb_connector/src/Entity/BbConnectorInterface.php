<?php

declare(strict_types=1);

namespace Drupal\bb_connector\Entity;

use Drupal\Core\Config\Entity\ConfigEntityInterface;

/**
 * Interface for bakers.build connector config entities.
 *
 * A connector represents one configured instance of an external system
 * (e.g. a specific GitLab installation) that bakers.build imports tickets from.
 */
interface BbConnectorInterface extends ConfigEntityInterface {

  /**
   * Returns the connector plugin ID (e.g. 'gitlab').
   */
  public function getPluginId(): string;

  /**
   * Returns the cron import interval in seconds (0 = cron import disabled).
   */
  public function getImportInterval(): int;

  /**
   * Returns a single plugin setting value or NULL when unset.
   */
  public function getSetting(string $key): mixed;

  /**
   * Returns all plugin settings.
   *
   * @return array<string, mixed>
   *   The settings map.
   */
  public function getSettings(): array;

}
