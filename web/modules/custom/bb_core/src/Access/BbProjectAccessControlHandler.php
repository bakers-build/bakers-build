<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;

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
    $perm = match ($operation) {
      'view' => 'view bb_project',
      'update' => 'edit bb_project',
      'delete' => 'delete bb_project',
      default => NULL,
    };
    return $perm === NULL ? $parent : AccessResult::allowedIfHasPermission($account, $perm);
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
