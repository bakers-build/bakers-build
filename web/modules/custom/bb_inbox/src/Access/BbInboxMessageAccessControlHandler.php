<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;

/**
 * Who sees and answers an inbox message.
 *
 * View: the requester, the conductor's owner (processing), or an
 * administrator. Generic ticket-view access is NOT sufficient (BB-661):
 * an answer can carry another user's sensitive result (e.g. a login URL),
 * so a co-viewer of the ticket who did not send the request never sees it
 * through direct entity/API access either.
 * Update: only the conductor's owner, and only status and result.
 * Create: closed to everyone but administrators; messages are created by the
 * sender service, which asks the responsible handler for access.
 */
final class BbInboxMessageAccessControlHandler extends EntityAccessControlHandler {

  private const CONDUCTOR_WRITABLE_FIELDS = ['status', 'result'];

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    $result = parent::checkAccess($entity, $operation, $account);
    if ($result->isAllowed() || !$entity instanceof BbInboxMessageInterface) {
      return $result;
    }
    return match ($operation) {
      'view' => $this->viewAccess($entity, $account),
      'update' => AccessResult::allowedIf($this->ownsConductor($entity, $account))
        ->cachePerUser()
        ->addCacheableDependency($entity),
      default => $result,
    };
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    return AccessResult::allowedIfHasPermission($account, 'administer bakers');
  }

  /**
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    if ($operation !== 'edit' || $account->hasPermission('administer bakers')) {
      return parent::checkFieldAccess($operation, $field_definition, $account, $items);
    }
    return AccessResult::allowedIf(in_array($field_definition->getName(), self::CONDUCTOR_WRITABLE_FIELDS, TRUE))
      ->cachePerPermissions();
  }

  /**
   * Requester or conductor owner only.
   *
   * A co-viewer of the ticket is not enough (BB-661) — a result can be
   * another person's sensitive answer.
   */
  private function viewAccess(BbInboxMessageInterface $message, AccountInterface $account): AccessResultInterface {
    if ((int) $message->get('requested_by')->target_id === (int) $account->id() && (int) $account->id() !== 0) {
      return AccessResult::allowed()->cachePerUser()->addCacheableDependency($message);
    }
    if ($this->ownsConductor($message, $account)) {
      return AccessResult::allowed()->cachePerUser()->addCacheableDependency($message);
    }
    return AccessResult::forbidden('Only the requester or the processing conductor owner may view this message.')
      ->cachePerUser()
      ->addCacheableDependency($message);
  }

  /**
   * Whether the account owns the message's conductor and runs conductors.
   */
  private function ownsConductor(BbInboxMessageInterface $message, AccountInterface $account): bool {
    $conductor = $message->conductor();
    return $conductor !== NULL
      && $account->hasPermission('register bakers conductor')
      && $conductor->isOwnedBy($account);
  }

}
