<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Access;

use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * Collection reads: the requester's own messages and the served conductors'.
 *
 * An owner reads the messages of the conductors they may still run
 * (ConductorRegistrar::serves()).
 *
 * Ticket viewers read messages through the resources and the web UI, which
 * check entity access per message.
 */
final class BbInboxMessageQueryAccessHandler extends QueryAccessHandler {

  /**
   * Constructs a BbInboxMessageQueryAccessHandler.
   *
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type definition.
   * @param \Drupal\Core\Entity\EntityTypeBundleInfoInterface $bundle_info
   *   The bundle info.
   * @param \Symfony\Component\EventDispatcher\EventDispatcherInterface $event_dispatcher
   *   The event dispatcher.
   * @param \Drupal\Core\Session\AccountInterface $current_user
   *   The current user.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Loads the account's conductors.
   * @param \Drupal\bb_core\Conductor\ConductorRegistrar $registrar
   *   Decides whether an owner may still run a conductor.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    EntityTypeBundleInfoInterface $bundle_info,
    EventDispatcherInterface $event_dispatcher,
    AccountInterface $current_user,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ConductorRegistrar $registrar,
  ) {
    parent::__construct($entity_type, $bundle_info, $event_dispatcher, $current_user);
  }

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    return new static(
      $entity_type,
      $container->get('entity_type.bundle.info'),
      $container->get('event_dispatcher'),
      $container->get('current_user'),
      $container->get('entity_type.manager'),
      $container->get('bb_core.conductor_registrar'),
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function buildEntityOwnerConditions($operation, AccountInterface $account) {
    $conditions = parent::buildEntityOwnerConditions($operation, $account);
    if ($operation !== 'view' || (int) $account->id() === 0) {
      return $conditions;
    }
    // An empty non-null group means the account may already see everything.
    if ($conditions !== NULL && $conditions->count() === 0) {
      return $conditions;
    }
    $conditions = $conditions ?? new ConditionGroup('OR');
    assert($conditions->getConjunction() === 'OR');
    $conditions->addCacheContexts(['user', 'user.permissions']);
    $conditions->addCacheTags(['og_membership_list']);
    $served = $this->servedConductorIds($account);
    if ($served !== []) {
      $conditions->addCondition('conductor_id', $served, 'IN');
    }
    $conditions->addCondition('requested_by', $account->id());
    return $conditions;
  }

  /**
   * Ids of the account's conductors it may still run.
   *
   * @return list<int|string>
   *   Conductor ids.
   */
  private function servedConductorIds(AccountInterface $account): array {
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $account->id())
      ->execute();
    $served = [];
    foreach ($storage->loadMultiple($ids) as $id => $conductor) {
      if ($conductor instanceof BbConductorInterface && $this->registrar->serves($conductor, $account)) {
        $served[] = $id;
      }
    }
    return $served;
  }

}
