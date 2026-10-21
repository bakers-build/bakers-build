<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Addon rows are readable and writable by administrators only.
 *
 * Rows are per definition and so per tenant. Product readers load through
 * the repository and check ticket or conductor access themselves.
 */
final class BbAddonAccessControlHandler extends EntityAccessControlHandler {

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    return AccessResult::allowedIfHasPermission($account, 'administer bakers');
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    return AccessResult::allowedIfHasPermission($account, 'administer bakers');
  }

}
