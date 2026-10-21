<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Core provider for profiles whose data is stored on their placements.
 */
final class DefaultAppProvider implements AppProviderInterface {

  /**
   * {@inheritdoc}
   */
  public function getId(): string {
    return 'default';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(App $app): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(App $app, IslandProfile $profile, string $placement_id): array {
    $placement = $profile->getPlacement($placement_id);
    return $placement['configuration'] ?? [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(App $app, IslandProfile $profile, string $placement_id, string $instance_id): array {
    $placement = $profile->getPlacement($placement_id);
    return $placement['data'] ?? $placement['configuration']['data'] ?? [];
  }

  /**
   * {@inheritdoc}
   */
  public function accessIsland(App $app, IslandProfile $profile, string $placement_id, string $instance_id): AccessResultInterface {
    return AccessResult::allowed();
  }

  /**
   * {@inheritdoc}
   */
  public function getEvents(App $app): array {
    return [];
  }

}
