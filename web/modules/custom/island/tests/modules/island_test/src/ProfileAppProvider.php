<?php

declare(strict_types=1);

namespace Drupal\island_test;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Plugin\Context\EntityContext;
use Drupal\Core\Plugin\Context\Context;
use Drupal\Core\Plugin\Context\ContextDefinition;
use Drupal\user\Entity\User;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\island\AppProviderInterface;
use Drupal\island\AppContextProviderInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Profile fixture with request-local access and distinct placement data.
 */
final class ProfileAppProvider implements AppProviderInterface, AppContextProviderInterface {

  /**
   * Placement IDs denied by the fixture's current access policy.
   *
   * @var string[]
   */
  public array $denied = [];

  /**
   * {@inheritdoc}
   */
  public function getId(): string {
    return 'profile_test';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(App $app): array {
    return ['task_list', 'task_count'];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(App $app, IslandProfile $profile, string $placement_id): array {
    return $profile->getPlacement($placement_id)['configuration'];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(App $app, IslandProfile $profile, string $placement_id, string $instance_id): array {
    return $profile->getPlacement($placement_id)['data'] ?? ['count' => 3];
  }

  /**
   * {@inheritdoc}
   */
  public function accessIsland(App $app, IslandProfile $profile, string $placement_id, string $instance_id): AccessResultInterface {
    return AccessResult::allowedIf(!in_array($placement_id, $this->denied, TRUE))
      ->addCacheContexts(['user.permissions'])
      ->addCacheTags(['profile_test:access'])
      ->setCacheMaxAge(37);
  }

  /**
   * Declares the typed app entity available when configuring mappings.
   */
  public function getProfileContexts(App $app, IslandProfile $profile): array {
    $user = User::create(['name' => 'Profile preview']);
    return [
      'entity' => EntityContext::fromEntity($user),
      'bundle' => new Context(new ContextDefinition('string', 'Bundle'), $user->bundle()),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getEvents(App $app): array {
    return ['tasks.changed', 'tasks.other'];
  }

}
