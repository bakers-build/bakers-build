<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_core\Access\BbRunParentageAccessCheck;
use Drupal\bb_track\Entity\Account;

/**
 * A billing account's page exists only under the account's own project.
 */
final class AccountRouteAccess {

  /**
   * Allowed when `{bb_project}` owns the account, else a marked 404.
   *
   * BbWorkspaceNotFoundSubscriber turns the parentage reason into a 404, so
   * the URL does not confirm that the account exists under another project.
   */
  public static function ownProject(EntityInterface $bb_project, EntityInterface $bb_track_account): AccessResultInterface {
    $owned = $bb_track_account instanceof Account
      && (int) $bb_track_account->get('project_id')->target_id === (int) $bb_project->id();
    $result = $owned ? AccessResult::allowed() : AccessResult::forbidden(BbRunParentageAccessCheck::PARENTAGE_MISMATCH_REASON);
    return $result->addCacheableDependency($bb_project)->addCacheableDependency($bb_track_account);
  }

}
