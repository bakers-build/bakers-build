<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_activity\Entity\NotificationSettingInterface;

/**
 * View and update follow NotificationSettingAccess; rows follow their account.
 */
final class NotificationSettingAccessControlHandler extends EntityAccessControlHandler {

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    if ($entity instanceof NotificationSettingInterface && in_array($operation, ['view', 'update'], TRUE)) {
      return AccessResult::allowed()
        ->addCacheableDependency($entity)
        ->andIf(NotificationSettingAccess::check((int) $entity->getOwnerId(), $account));
    }
    return AccessResult::forbidden('Notification settings rows follow their account.')->cachePerPermissions();
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    return AccessResult::forbidden('Notification settings rows follow their account.')->cachePerPermissions();
  }

}
