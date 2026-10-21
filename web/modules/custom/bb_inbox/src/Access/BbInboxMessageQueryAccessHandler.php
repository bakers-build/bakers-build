<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Access;

use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;

/**
 * Collection reads: the conductor owner's messages and the requester's own.
 *
 * Ticket viewers read messages through the resources and the web UI, which
 * check entity access per message.
 */
final class BbInboxMessageQueryAccessHandler extends QueryAccessHandler {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityOwnerConditions($operation, AccountInterface $account) {
    $conditions = parent::buildEntityOwnerConditions($operation, $account);
    if ($operation !== 'view' || (int) $account->id() === 0) {
      return $conditions;
    }
    // An empty non-null group means the account may already see everything.
    if ($conditions !== NULL && $conditions->count() === 0) {
      return $conditions;
    }
    $conditions = $conditions ?? new ConditionGroup('OR');
    assert($conditions->getConjunction() === 'OR');
    $conditions->addCacheContexts(['user', 'user.permissions']);
    if ($account->hasPermission('register bakers conductor')) {
      $conditions->addCondition('owner_user_id', $account->id());
    }
    $conditions->addCondition('requested_by', $account->id());
    return $conditions;
  }

}
