<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;

/**
 * Webhook access: the permissions, fenced to the own workspace by bb_core.
 *
 * The secret is never readable or editable through field access; it is shown
 * once, by the add form, after the first save.
 */
final class BbWebhookAccessControlHandler extends EntityAccessControlHandler {

  /**
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    if ($field_definition->getName() === 'secret') {
      return AccessResult::forbidden('The webhook secret is write-only.');
    }
    return parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

}
