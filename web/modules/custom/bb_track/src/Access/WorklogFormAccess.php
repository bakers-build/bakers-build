<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbGroupScopedAccount;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Symfony\Component\HttpFoundation\Request;

/**
 * Route access for native Worklog forms.
 */
final class WorklogFormAccess {

  /**
   * Allows add when the account can record in any of their workspaces.
   */
  public static function add(AccountInterface $account): AccessResultInterface {
    $denied = AccessResult::forbidden()
      ->addCacheContexts(['user', 'user.permissions'])
      ->addCacheTags(['og_membership_list']);
    if ($account->isAnonymous()) {
      return $denied;
    }
    $workspace_ids = \Drupal::service('bb_core.workspace_read_scope')->workspaceIds($account);
    if ($workspace_ids === []) {
      return $denied;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_workspace');
    foreach ($workspace_ids as $workspace_id) {
      $workspace = $storage->load($workspace_id);
      if ($workspace instanceof BbWorkspaceInterface && self::canRecord($account, $workspace)) {
        return AccessResult::allowed()
          ->addCacheContexts(['user', 'user.permissions'])
          ->addCacheTags(['og_membership_list']);
      }
    }
    return $denied;
  }

  /**
   * Allows edit and delete routes to the entry's owner only.
   *
   * View access reaches team leads; the forms never do.
   */
  public static function own(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $entry = $route_match->getParameter('bb_track_worklog');
    if (!$entry instanceof Worklog) {
      return AccessResult::forbidden()->addCacheContexts(['user']);
    }
    return AccessResult::allowedIf(!$account->isAnonymous() && (int) $entry->getOwnerId() === (int) $account->id())
      ->addCacheContexts(['user'])
      ->addCacheableDependency($entry);
  }

  /**
   * Allows ticket search only on a project the account may record on.
   */
  public static function ticketOptions(AccountInterface $account, ?Request $request = NULL): AccessResultInterface {
    $id = ($request ?? \Drupal::request())->query->get('project');
    $project = is_string($id) && ctype_digit($id)
      ? \Drupal::entityTypeManager()->getStorage('bb_project')->load($id)
      : NULL;
    $allowed = !$account->isAnonymous()
      && $project instanceof BbProjectInterface
      && $project->access('view', $account)
      && in_array((int) $project->id(), \Drupal::service('bb_core.workspace_read_scope')->projectIds($account), TRUE)
      && self::canRecordOnProject($account, $project);
    return AccessResult::allowedIf($allowed)
      ->addCacheContexts(['user', 'url.query_args:project'])
      ->addCacheTags(['og_membership_list']);
  }

  /**
   * Whether the account may record time in this workspace.
   */
  public static function canRecord(
    AccountInterface $account,
    BbWorkspaceInterface $workspace,
  ): bool {
    $rank = \Drupal::service('bb_core.rank_capability');
    $scoped = new BbGroupScopedAccount($account, [$workspace], $rank);
    return $scoped->hasPermission('record own worklog');
  }

  /**
   * Whether the account may record time against this project's live workspace.
   */
  public static function canRecordOnProject(
    AccountInterface $account,
    BbProjectInterface $project,
  ): bool {
    $group = $project->getGroup();
    if (!$group instanceof BbGroupInterface) {
      return FALSE;
    }
    $workspace = $group->get('workspace_id')->entity;
    return $workspace instanceof BbWorkspaceInterface
      && self::canRecord($account, $workspace);
  }

}
