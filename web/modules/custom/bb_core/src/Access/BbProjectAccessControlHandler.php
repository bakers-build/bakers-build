<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * Granular per-operation access for bb_project; admin_permission bypasses.
 */
final class BbProjectAccessControlHandler extends EntityAccessControlHandler {

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    // Admin-permission bypass (administer bakers) and core forbidden results
    // (e.g. delete on a new/unsaved entity) are handled by the parent.
    $parent = parent::checkAccess($entity, $operation, $account);
    if (!$parent->isNeutral()) {
      return $parent;
    }
    if ($operation === 'delete') {
      // The generated `delete own` grant; the workspace owner's delete is
      // added by BbRankEntityFence.
      return $this->ownerResult($entity, 'delete own bb_project', $account);
    }
    if ($operation === 'update') {
      return AccessResult::allowedIfHasPermission($account, 'edit bb_project')
        ->orIf($this->ownerResult($entity, 'update own bb_project', $account));
    }
    return $operation === 'view' ? AccessResult::allowedIfHasPermission($account, 'view bb_project') : $parent;
  }

  /**
   * {@inheritdoc}
   *
   * An owner editing through `update own bb_project` cannot change a saved
   * project's teams, or removing their own team would lock them out; only an
   * `edit bb_project` holder moves them. Group and owner are already
   * server-maintained on saved rows (AccessFenceHooks::SAVED_ROW_EDITABLE).
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    $result = parent::checkFieldAccess($operation, $field_definition, $account, $items);
    if ($operation === 'edit' && $field_definition->getName() === 'teams' && $items !== NULL && !$items->getEntity()->isNew()) {
      return AccessResult::forbiddenIf(
        !$account->hasPermission('administer bakers') && !$account->hasPermission('edit bb_project'),
        'Only a project editor changes its teams.',
      )->cachePerPermissions()->orIf($result);
    }
    return $result;
  }

  /**
   * Allows an `<operation> own` permission on the account's own project.
   */
  private function ownerResult(EntityInterface $entity, string $permission, AccountInterface $account): AccessResultInterface {
    return AccessResult::allowedIf(
      $account->hasPermission($permission)
        && $entity instanceof EntityOwnerInterface
        && (int) $entity->getOwnerId() === (int) $account->id(),
    )->cachePerPermissions()->cachePerUser()->addCacheableDependency($entity);
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    // Honor the admin_permission bypass here too (core does not auto-bypass it
    // for create): `administer bakers` OR the granular `create bb_project`.
    return AccessResult::allowedIfHasPermissions($account, ['administer bakers', 'create bb_project'], 'OR');
  }

}
