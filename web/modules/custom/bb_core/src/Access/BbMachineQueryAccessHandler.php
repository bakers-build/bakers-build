<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * Mirrors BbMachineAccessControlHandler as a query condition.
 *
 * Stock QueryAccessHandler treats OG-unioned `view bb_machine` as view-any.
 * Owner rows stay visible; a site-wide view grant (agent Drupal role / OAuth
 * machine scope) sees every row; everyone else sees none.
 */
final class BbMachineQueryAccessHandler extends QueryAccessHandler {

  /**
   * Constructs a BbMachineQueryAccessHandler.
   *
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type definition.
   * @param \Drupal\Core\Entity\EntityTypeBundleInfoInterface $bundle_info
   *   The bundle info.
   * @param \Symfony\Component\EventDispatcher\EventDispatcherInterface $event_dispatcher
   *   The event dispatcher.
   * @param \Drupal\Core\Session\AccountInterface $current_user
   *   The current user.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $capability
   *   Distinguishes a Drupal-role / OAuth grant from an OG-unioned one.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    EntityTypeBundleInfoInterface $bundle_info,
    EventDispatcherInterface $event_dispatcher,
    AccountInterface $current_user,
    private readonly BbRankCapabilityInterface $capability,
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
      $container->get('bb_core.rank_capability'),
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function buildEntityOwnerConditions($operation, AccountInterface $account) {
    if (!in_array($operation, ['view', 'update'], TRUE)) {
      return parent::buildEntityOwnerConditions($operation, $account);
    }

    if ($operation === 'view'
      && $this->capability->hasSiteWidePermission($account, 'view bb_machine')) {
      $conditions = new ConditionGroup('OR');
      $conditions->addCacheContexts(['user.permissions']);
      return $conditions;
    }

    if ((int) $account->id() === 0) {
      return NULL;
    }

    if ($operation === 'update'
      && !$account->hasPermission('update own bb_machine')) {
      return NULL;
    }

    $conditions = new ConditionGroup('OR');
    $conditions->addCacheContexts(['user', 'user.permissions']);
    $owner_key = $this->entityType->getKey('owner');
    assert(is_string($owner_key) && $owner_key !== '');
    // $account->id() is passed VERBATIM. entity_jsonapi_entity_filter_access()
    // compares it with ===; a cast makes that comparison fail.
    $conditions->addCondition($owner_key, $account->id());

    return $conditions;
  }

}
