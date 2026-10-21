<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\EntityReferenceFieldItemListInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Activity visibility follows the parent ticket; writes are server-only.
 */
final class BbActivityAccessControlHandler extends EntityAccessControlHandler {

  /**
   * Related fields whose view follows the target entity.
   *
   * @var array<string>
   */
  private const RELATED_FIELDS = ['actor', 'run_id', 'conductor_id', 'comment_id', 'accounts'];

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    if ($operation === 'view') {
      return $this->viewAccess($entity, $account);
    }
    return AccessResult::forbidden('bakers.build activities are server-written.')
      ->cachePerPermissions()
      ->addCacheableDependency($entity);
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    return AccessResult::forbidden('bakers.build activities are server-written.')
      ->cachePerPermissions();
  }

  /**
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    if ($operation === 'edit') {
      return AccessResult::forbidden('bakers.build activities are server-written.')
        ->cachePerPermissions();
    }
    if (in_array($field_definition->getName(), self::RELATED_FIELDS, TRUE) && $items !== NULL) {
      return $this->relatedViewAccess($field_definition->getName(), $items, $account);
    }
    return parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

  /**
   * View is allowed only when the parent ticket is viewable.
   */
  private function viewAccess(EntityInterface $entity, AccountInterface $account): AccessResultInterface {
    assert($entity instanceof BbActivity);
    $ticket = $entity->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface) {
      return AccessResult::forbidden('Activity has no readable parent ticket.')
        ->addCacheableDependency($entity);
    }
    $ticket_access = $ticket->access('view', $account, TRUE);
    $result = $ticket_access->isAllowed()
      ? AccessResult::allowed()
      : AccessResult::forbidden();
    return $result
      ->addCacheableDependency($ticket_access)
      ->addCacheableDependency($entity);
  }

  /**
   * Related reference view follows the target; missing targets stay hidden.
   */
  private function relatedViewAccess(string $field_name, FieldItemListInterface $items, AccountInterface $account): AccessResultInterface {
    $activity = $items->getEntity();
    if ($field_name === 'actor' && (int) $items->target_id === 0) {
      return AccessResult::allowed()->addCacheableDependency($activity);
    }
    if ($field_name === 'accounts') {
      return $this->accountsViewAccess($items, $account);
    }
    $target = $items->entity;
    if ($target === NULL) {
      return AccessResult::forbidden()
        ->addCacheableDependency($activity);
    }
    $target_access = $target->access('view', $account, TRUE);
    $result = $target_access->isAllowed()
      ? AccessResult::allowed()
      : AccessResult::forbidden();
    return $result
      ->addCacheableDependency($target_access)
      ->addCacheableDependency($activity);
  }

  /**
   * Every addressed account must be viewable; an empty list hides nothing.
   */
  private function accountsViewAccess(FieldItemListInterface $items, AccountInterface $account): AccessResultInterface {
    assert($items instanceof EntityReferenceFieldItemListInterface);
    $result = AccessResult::allowed()->addCacheableDependency($items->getEntity());
    $targets = $items->referencedEntities();
    if (count($targets) !== $items->count()) {
      return AccessResult::forbidden()->addCacheableDependency($items->getEntity());
    }
    foreach ($targets as $target) {
      $result = $result->andIf($target->access('view', $account, TRUE));
    }
    return $result;
  }

}
