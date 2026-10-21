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
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;

/**
 * Composes the three facts that authorize a Service Accounts management action.
 *
 * 1. The acting account has `update` access on the workspace (reuses the
 *    same `bb_workspace.update` permission every other settings tab
 *    gates on — no separate Service Accounts permission is introduced).
 * 2. When a target user is given, it is a service account bound to THIS
 *    workspace, never a human or a foreign workspace's account.
 * 3. When a target consumer is given, it is a managed key
 *    (`ApiKeyManager::isManaged()`) belonging to that same target user,
 *    never an ordinary consumer or another account's key.
 *
 * Bearer (OAuth) authentication cannot satisfy this: `$actor` must come
 * through the cookie-authenticated session, which the workspace's own
 * `update` access already requires.
 */
final class ServiceAccountAccess {

  public function __construct(
    private readonly ServiceAccountManager $serviceAccountManager,
    private readonly ApiKeyManager $apiKeyManager,
  ) {}

  /**
   * Composes workspace-update, marker-binding and managed-consumer access.
   */
  public function manage(
    BbWorkspaceInterface $workspace,
    AccountInterface $actor,
    ?UserInterface $serviceUser = NULL,
    ?ConsumerInterface $consumer = NULL,
  ): AccessResultInterface {
    $workspaceAccess = $workspace->access('update', $actor, TRUE);
    assert($workspaceAccess instanceof AccessResult);
    $result = $workspaceAccess->addCacheContexts(['user']);

    if ($serviceUser !== NULL) {
      $bound = $this->serviceAccountManager->belongsTo($serviceUser, $workspace);
      $result = $result
        ->andIf(AccessResult::allowedIf($bound))
        ->addCacheableDependency($serviceUser);
    }

    if ($consumer !== NULL) {
      $managed = $this->apiKeyManager->isManaged($consumer);
      $ownedByServiceUser = $serviceUser !== NULL
        && (int) $consumer->get('owner_id')->target_id === (int) $serviceUser->id()
        && (int) $consumer->get('user_id')->target_id === (int) $serviceUser->id();
      $result = $result
        ->andIf(AccessResult::allowedIf($managed && $ownedByServiceUser))
        ->addCacheableDependency($consumer);
    }

    return $result;
  }

  /**
   * Route access for the account-create form: the path workspace alone.
   */
  public function createAccount(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $workspace = $route_match->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      return AccessResult::forbidden()->addCacheContexts(['url.path']);
    }
    return $this->manage($workspace, $account);
  }

  /**
   * Route access for a form naming the workspace and a target service user.
   *
   * Covers key-issue and disable: both act on one existing service account
   * and need no target consumer.
   */
  public function manageAccount(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $workspace = $route_match->getParameter('bb_workspace');
    $user = $route_match->getParameter('user');
    if (!$workspace instanceof BbWorkspaceInterface || !$user instanceof UserInterface) {
      return AccessResult::forbidden()->addCacheContexts(['url.path']);
    }
    return $this->manage($workspace, $account, $user);
  }

  /**
   * Route access for the key-issue form: manageAccount() and an active account.
   */
  public function issueKey(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $result = $this->manageAccount($route_match, $account);
    $user = $route_match->getParameter('user');
    return $result->andIf(AccessResult::allowedIf($user instanceof UserInterface && $user->isActive()));
  }

  /**
   * Route access for the key-revoke form: workspace, user AND consumer match.
   */
  public function manageKey(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $workspace = $route_match->getParameter('bb_workspace');
    $user = $route_match->getParameter('user');
    $consumer = $route_match->getParameter('consumer');
    if (!$workspace instanceof BbWorkspaceInterface || !$user instanceof UserInterface || !$consumer instanceof ConsumerInterface) {
      return AccessResult::forbidden()->addCacheContexts(['url.path']);
    }
    return $this->manage($workspace, $account, $user, $consumer);
  }

}
