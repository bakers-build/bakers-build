<?php

declare(strict_types=1);

namespace Drupal\bb_browser_test;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Plugin\Context\EntityContext;
use Drupal\Core\Plugin\Context\Context;
use Drupal\Core\Plugin\Context\ContextDefinition;
use Drupal\island\AppContextProviderInterface;
use Drupal\island\AppProviderInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\user\Entity\User;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Supplies two server-owned instances of the recipe's browser profile.
 */
final class BrowserAppProvider implements AppProviderInterface, AppContextProviderInterface {

  public function __construct(
    private readonly AccountInterface $account,
    private readonly RequestStack $requestStack,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function getId(): string {
    return 'browser_test';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(App $app): array {
    return ['browser_counter', 'ui_patterns_component'];
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
    $refreshed = $this->requestStack->getCurrentRequest()?->attributes->get('bb_browser_test_refreshed', FALSE);
    return [
      'instance' => $instance_id,
      'contexts' => $this->userContexts(($refreshed ? 'Refreshed ' : 'Initial ') . $instance_id),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getProfileContexts(App $app, IslandProfile $profile): array {
    return $this->userContexts('Preview context');
  }

  /**
   * Declares the entity and bundle UI Patterns needs for field derivation.
   *
   * @return array<string, \Drupal\Core\Plugin\Context\ContextInterface>
   *   Typed, transient app data; no fixture user is persisted.
   */
  private function userContexts(string $name): array {
    $user = User::create(['name' => $name]);
    return [
      'entity' => EntityContext::fromEntity($user),
      'bundle' => new Context(new ContextDefinition('string', 'Bundle'), $user->bundle()),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function accessIsland(App $app, IslandProfile $profile, string $placement_id, string $instance_id): AccessResultInterface {
    return AccessResult::allowedIfHasPermission($this->account, 'administer island profiles');
  }

  /**
   * {@inheritdoc}
   */
  public function getEvents(App $app): array {
    return ['counter.changed', 'counter.other'];
  }

}
