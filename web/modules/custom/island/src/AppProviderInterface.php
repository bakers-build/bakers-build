<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Access\AccessResultInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Provides an application's island capabilities and request context.
 */
interface AppProviderInterface {

  /**
   * Returns the provider's configuration identifier.
   */
  public function getId(): string;

  /**
   * Returns the plugin ids available to an app.
   *
   * @return string[]
   *   Island plugin ids.
   */
  public function getIslandIds(App $app): array;

  /**
   * Returns configuration for one profile placement.
   */
  public function getIslandConfiguration(App $app, IslandProfile $profile, string $placement_id): array;

  /**
   * Returns current request data for one profile placement.
   */
  public function getIslandData(App $app, IslandProfile $profile, string $placement_id, string $instance_id): array;

  /**
   * Checks access to one placement in its current request context.
   */
  public function accessIsland(App $app, IslandProfile $profile, string $placement_id, string $instance_id): AccessResultInterface;

  /**
   * Returns event names this app may expose to placements.
   *
   * @return string[]
   *   Event names.
   */
  public function getEvents(App $app): array;

}
