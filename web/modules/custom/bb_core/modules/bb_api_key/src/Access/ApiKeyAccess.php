<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\user\UserInterface;

/**
 * Route access for the self-service API-key area.
 *
 * Same personal-ownership shape as bb_track's `TimeRouteAccess::personal`
 * (this module does not depend on bb_track for it): the list, create and
 * delete routes all belong to the path's own user alone. Admin status never
 * substitutes for that match.
 */
final class ApiKeyAccess {

  public function __construct(
    private readonly ApiKeyManager $apiKeyManager,
    private readonly ServiceAccountManager $serviceAccountManager,
    private readonly ServiceAccountAccess $serviceAccountAccess,
  ) {}

  /**
   * The key list: the owner, or a service account's workspace administrator.
   *
   * A service account's keys are managed by its workspace, not by itself.
   *
   * Only the list: creating and revoking a service account's key go through
   * the service-account routes, never the owner-only personal forms.
   */
  public function keyList(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $personal = $this->personal($route_match, $account);
    $user = $route_match->getParameter('user');
    if ($personal->isAllowed() || !$user instanceof UserInterface) {
      return $personal;
    }
    $workspace = $this->serviceAccountManager->workspace($user);
    if ($workspace === NULL) {
      return $personal;
    }
    return $this->serviceAccountAccess->manage($workspace, $account, $user);
  }

  /**
   * The list/create routes: the path user must be the current account.
   */
  public function personal(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $user = $route_match->getParameter('user');
    $own = $user instanceof UserInterface
      && $account->isAuthenticated()
      && (int) $user->id() === (int) $account->id();
    return AccessResult::allowedIf($own)->addCacheContexts(['user', 'url.path']);
  }

  /**
   * The revoke route: the path user AND the consumer must both match.
   */
  public function revoke(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $personal = $this->personal($route_match, $account);
    if (!$personal->isAllowed()) {
      return $personal;
    }

    $consumer = $route_match->getParameter('consumer');
    if (!$consumer instanceof ConsumerInterface) {
      return AccessResult::forbidden()->addCacheContexts(['user', 'url.path']);
    }

    $owned = $this->apiKeyManager->isOwnedBy($consumer, $account);
    return AccessResult::allowedIf($owned)
      ->addCacheContexts(['user', 'url.path'])
      ->addCacheableDependency($consumer);
  }

}
