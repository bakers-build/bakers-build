<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;

/**
 * Query access for invitations, by the generic permissions alone.
 *
 * `BbInvite` declares no `owner` key on purpose, which the stock handler
 * refuses. An invitation has no "own" grant, so the owner branch is skipped;
 * WorkspaceReadScopeSubscriber narrows the result to the workspaces whose
 * rank grants `view bb_invite`.
 */
final class BbInviteQueryAccessHandler extends QueryAccessHandler {

  /**
   * {@inheritdoc}
   */
  public function buildConditions($operation, AccountInterface $account) {
    $admin_permission = $this->entityType->getAdminPermission() ?: 'administer bb_invite';
    $conditions = $account->hasPermission($admin_permission)
      ? new ConditionGroup('OR')
      : $this->buildEntityConditions($operation, $account);
    if ($conditions === NULL) {
      $conditions = (new ConditionGroup('OR'))->alwaysFalse();
    }
    return $conditions->addCacheContexts(['user.permissions']);
  }

}
