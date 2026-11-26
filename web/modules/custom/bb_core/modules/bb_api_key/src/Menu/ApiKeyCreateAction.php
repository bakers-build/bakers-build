<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Menu;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Menu\LocalActionDefault;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Menu\CreateActionAccessInterface;
use Drupal\user\UserInterface;

/**
 * The `Create API key` plus on a key list, for its owner or service account.
 *
 * A service account's keys go through its workspace's route (lock, binding
 * and admin checks), never the owner-only form; the workspace comes from the
 * account, because the `/user/{user}` key list has none.
 */
final class ApiKeyCreateAction extends LocalActionDefault implements CreateActionAccessInterface {

  /**
   * The service-account key route.
   */
  private const string SERVICE_ACCOUNT_ROUTE = 'bb_api_key.service_account.key_add';

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The parameters; the service-account route lacks its workspace on an
   *   owner's own list, so it is not offered there.
   */
  public function getRouteParameters(RouteMatchInterface $route_match): array {
    $parameters = parent::getRouteParameters($route_match);
    if ($this->getRouteName() === self::SERVICE_ACCOUNT_ROUTE) {
      unset($parameters['bb_workspace']);
      $workspace = $this->serviceWorkspace($route_match);
      if ($workspace !== NULL) {
        $parameters['bb_workspace'] = $workspace->getSlug();
      }
    }
    return $parameters;
  }

  /**
   * {@inheritdoc}
   *
   * The owner's form is never offered on a service account's key list.
   */
  public function createAccess(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $personal_on_service = $this->getRouteName() !== self::SERVICE_ACCOUNT_ROUTE && $this->serviceWorkspace($route_match) !== NULL;
    return AccessResult::forbiddenIf($personal_on_service)->addCacheContexts(['route']);
  }

  /**
   * The workspace of the service account whose key list this is, if any.
   */
  private function serviceWorkspace(RouteMatchInterface $route_match): ?BbWorkspaceInterface {
    $user = $route_match->getParameter('user');
    $workspace = $user instanceof UserInterface ? $user->get(ServiceAccountManager::MARKER_FIELD)->entity : NULL;
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

}
