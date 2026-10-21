<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;

/**
 * Mirrors the conductor-ownership view/update grant as a query condition.
 *
 * BbConductorAccessControlHandler and BbRunAccessControlHandler both widen
 * the plain permission check with "and the account owns this row", gated on
 * `register bakers conductor`. This is the same rule expressed as SQL, so a
 * collection query returns a full page and its count is the number the account
 * may actually view.
 *
 * The owner field is read off the entity type's `owner` key rather than named
 * here, which is why one class serves both entity types.
 */
final class BbOwnerGrantQueryAccessHandler extends QueryAccessHandler {

  /**
   * Adds the owner condition on top of whatever the permissions already allow.
   *
   * {@inheritdoc}
   */
  protected function buildEntityOwnerConditions($operation, AccountInterface $account) {
    $conditions = parent::buildEntityOwnerConditions($operation, $account);

    // Only the two operations the access control handlers actually widen.
    if (!in_array($operation, ['view', 'update'], TRUE)) {
      return $conditions;
    }
    if (!$account->hasPermission('register bakers conductor')) {
      return $conditions;
    }
    // Anonymous owns nothing. Without this, an anonymous account holding the
    // permission would match every row whose owner is 0 — the value an unowned
    // row carries, because core stores an entity-key column NOT NULL.
    if ((int) $account->id() === 0) {
      return $conditions;
    }
    // A non-null empty group means the permission already grants everything.
    // Adding a condition here would REVOKE access checkAccess() grants, which
    // must never happen.
    if ($conditions !== NULL && $conditions->count() === 0) {
      return $conditions;
    }

    $conditions = $conditions ?? new ConditionGroup('OR');
    // The parent builds OR groups on both paths; assert it rather than assume,
    // because adding to an AND group would narrow instead of widen.
    assert($conditions->getConjunction() === 'OR');
    $conditions->addCacheContexts(['user']);
    // QueryAccessHandlerBase::buildConditions() has already thrown if an
    // EntityOwnerInterface type were missing its owner key, so this narrows a
    // string|false return rather than guarding a reachable branch.
    $owner_key = $this->entityType->getKey('owner');
    assert(is_string($owner_key) && $owner_key !== '');
    // $account->id() is passed VERBATIM. entity_jsonapi_entity_filter_access()
    // compares it with ===, and a cast makes that comparison fail, which sends
    // every FILTERED collection read through alwaysFalse() and returns zero
    // rows with no error. Do not cast this.
    $conditions->addCondition($owner_key, $account->id());

    return $conditions;
  }

}
