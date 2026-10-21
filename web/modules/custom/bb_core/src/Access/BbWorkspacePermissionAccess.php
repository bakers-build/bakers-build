<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\Access\AccessInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Requires a permission in the route's workspace, not in the OG union.
 *
 * `_permission` reads the union of every workspace's rank, so a rank in one
 * workspace would open another where the account is only a guest.
 *
 * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
 */
final class BbWorkspacePermissionAccess implements AccessInterface {

  /**
   * Constructs the scoped permission check.
   */
  public function __construct(
    private readonly BbRankCapabilityInterface $capability,
    private readonly bool $superUserEnabled,
  ) {
  }

  /**
   * Checks the requirement's permission in the route's workspace.
   */
  public function access(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $permission = (string) $route_match->getRouteObject()?->getRequirement('_bb_workspace_permission');
    $workspace = $route_match->getParameter('bb_workspace');
    $result = AccessResult::neutral()
      ->addCacheContexts(['user', 'user.permissions', 'route'])
      ->addCacheTags(['og_membership_list', 'config:og_role_list']);
    if ($permission === '' || !$workspace instanceof BbWorkspaceInterface) {
      return AccessResult::forbidden()->addCacheableDependency($result);
    }
    // Drupal's uid-1 policy is a site-wide grant the scoped account omits.
    $scoped = $this->superUserEnabled && (int) $account->id() === 1
      ? $account
      : new BbGroupScopedAccount($account, [$workspace], $this->capability);
    return AccessResult::allowedIf($scoped->hasPermission($permission))
      ->addCacheableDependency($result)
      ->addCacheableDependency($workspace);
  }

}
