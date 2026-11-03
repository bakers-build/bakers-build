<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityHandlerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_core\Entity\BbMachineInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Gates machine view and update on the owning account, not a workspace rank.
 *
 * `view bb_machine` is still an OG listing permission (the Views page).
 * Layer A unions that grant into `hasPermission()`, so the stock entity
 * handler would treat every ranked human as able to view every machine.
 * Owner view/update, and site-wide `view bb_machine` for agent identities,
 * are the product rules; OG-unioned view/update-any must not become them.
 */
final class BbMachineAccessControlHandler extends EntityAccessControlHandler implements EntityHandlerInterface {

  /**
   * Constructs a BbMachineAccessControlHandler.
   *
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type definition.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $capability
   *   Distinguishes a Drupal-role / OAuth grant from an OG-unioned one.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    private readonly BbRankCapabilityInterface $capability,
  ) {
    parent::__construct($entity_type);
  }

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    return new static(
      $entity_type,
      $container->get('bb_core.rank_capability'),
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    if (!in_array($operation, ['view', 'update'], TRUE)) {
      return parent::checkAccess($entity, $operation, $account);
    }

    $admin = $this->entityType->getAdminPermission();
    if (is_string($admin) && $admin !== '' && $account->hasPermission($admin)) {
      return AccessResult::allowed()
        ->cachePerPermissions()
        ->addCacheableDependency($entity);
    }

    $owner = $this->ownerAccess($entity, $operation, $account);
    if ($owner !== NULL) {
      return $owner;
    }

    if ($operation === 'view'
      && $this->capability->hasSiteWidePermission($account, 'view bb_machine')) {
      return AccessResult::allowed()
        ->cachePerPermissions()
        ->addCacheableDependency($entity);
    }

    return AccessResult::forbidden()
      ->cachePerUser()
      ->addCacheableDependency($entity);
  }

  /**
   * Owner view is by account; owner update also needs the own-machine grant.
   *
   * A user-bound token without `update own bb_machine` must 403, while a
   * cookie session whose rank carries that permission may edit.
   */
  private function ownerAccess(EntityInterface $entity, string $operation, AccountInterface $account): ?AccessResultInterface {
    $is_owner = $entity instanceof BbMachineInterface
      && (int) $account->id() !== 0
      && (int) $entity->get('owner_user_id')->target_id === (int) $account->id();
    if (!$is_owner) {
      return NULL;
    }
    if ($operation === 'view') {
      return AccessResult::allowed()
        ->cachePerUser()
        ->addCacheableDependency($entity);
    }
    if ($operation === 'update' && $account->hasPermission('update own bb_machine')) {
      return AccessResult::allowed()
        ->cachePerUser()
        ->cachePerPermissions()
        ->addCacheableDependency($entity);
    }
    return NULL;
  }

  /**
   * Host key is frozen after save; other fields follow the saved-row allowlist.
   *
   * Host key is settable while the machine is new (admin add, registrar
   * create) and frozen afterwards, the same shape as ticket `branch_name`.
   * Current load, owner, created and changed stay on the saved-row
   * allowlist: ordinary editors cannot write them, instance admins can.
   * JSON:API PATCH consults field access alone; server-side saves are
   * unaffected.
   *
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    if ($operation !== 'edit' || $field_definition->getName() !== 'host_key') {
      return parent::checkFieldAccess($operation, $field_definition, $account, $items);
    }
    $machine = $items?->getEntity();
    if (!$machine instanceof BbMachineInterface || $machine->isNew()) {
      return parent::checkFieldAccess($operation, $field_definition, $account, $items);
    }
    return AccessResult::forbidden('The host key is frozen once the machine exists.')
      ->addCacheableDependency($machine);
  }

}
