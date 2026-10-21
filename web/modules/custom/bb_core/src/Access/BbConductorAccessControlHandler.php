<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * Allows conductor accounts to manage their own registration.
 */
final class BbConductorAccessControlHandler extends EntityAccessControlHandler {

  /**
   * Grants view and update access to the conductor who owns the entity.
   *
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    $result = parent::checkAccess($entity, $operation, $account);
    if (in_array($operation, ['view', 'update'], TRUE)
      && !$result->isAllowed()
      && $account->hasPermission('register bakers conductor')
      && $entity instanceof BbConductorInterface
      && $entity->isOwnedBy($account)) {
      return AccessResult::allowed()
        ->cachePerUser()
        ->addCacheableDependency($entity);
    }
    return $result;
  }

  /**
   * Grants create access to accounts with the conductor registration right.
   *
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    $result = parent::checkCreateAccess($account, $context, $entity_bundle);
    if (!$result->isAllowed() && $account->hasPermission('register bakers conductor')) {
      return AccessResult::allowed()->cachePerPermissions();
    }
    return $result;
  }

}
