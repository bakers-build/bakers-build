<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Routing\Access\AccessInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Authorizes group, team and template creation in the route's workspace.
 *
 * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
 */
final class BbWorkspaceCreateAccess implements AccessInterface {

  /**
   * Constructs the scoped create check.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbRankCapabilityInterface $capability,
    private readonly bool $superUserEnabled,
  ) {
  }

  /**
   * Checks the route without trusting the account's cross-workspace union.
   */
  public function access(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    return $this->check(
      (string) $route_match->getRouteObject()?->getRequirement('_bb_workspace_create'),
      $route_match->getParameter('bb_workspace'),
      $account,
    );
  }

  /**
   * Gives the route and every form phase the same scoped handler decision.
   */
  public function check(string $type, mixed $workspace, AccountInterface $account): AccessResultInterface {
    $result = AccessResult::forbidden()
      ->addCacheContexts(['user', 'user.permissions', 'route'])
      ->addCacheTags(['og_membership_list', 'config:og_role_list']);
    if (!in_array($type, ['bb_group', 'bb_team', 'bb_ticket_template'], TRUE) || !$workspace instanceof BbWorkspaceInterface || $workspace->isNew()) {
      return $result;
    }
    // Drupal's configured uid-1 policy is a site-wide grant too. A scoped
    // account intentionally omits access policies, so retain the original
    // account for this one policy when it is enabled.
    $scoped = $this->superUserEnabled && (int) $account->id() === 1
      ? $account
      : new BbGroupScopedAccount($account, [$workspace], $this->capability);
    $handler = $this->entityTypeManager->getAccessControlHandler($type);
    // The decorated account keeps its uid, so neither pass may reuse the
    // handler's cached answer for the original account with that same uid.
    $handler->resetCache();
    try {
      $access = $handler->createAccess(NULL, $scoped, ['workspace' => $workspace], TRUE);
    }
    finally {
      $handler->resetCache();
    }
    return AccessResult::allowedIf($access->isAllowed())
      ->addCacheableDependency($result)
      ->addCacheableDependency($access)
      ->addCacheableDependency($workspace);
  }

}
