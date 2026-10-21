<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountSwitcherInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\entity\QueryAccess\QueryAccessHandlerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * Restricts billing accounts to the requesting account's readable projects.
 */
final class AccountQueryAccessHandler extends QueryAccessHandler {

  /**
   * Constructs an AccountQueryAccessHandler.
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
   *   Used to load the requesting account's readable projects.
   * @param \Drupal\Core\Session\AccountSwitcherInterface $accountSwitcher
   *   Switches to the supplied account before the project query.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    EntityTypeBundleInfoInterface $bundle_info,
    EventDispatcherInterface $event_dispatcher,
    AccountInterface $current_user,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AccountSwitcherInterface $accountSwitcher,
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
      $container->get('account_switcher'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function buildConditions($operation, AccountInterface $account): ConditionGroup {
    $conditions = new ConditionGroup('AND');
    $conditions->addCacheContexts(['user', 'user.permissions']);
    if ($operation !== 'view') {
      return $conditions->alwaysFalse();
    }

    $this->accountSwitcher->switchTo($account);
    try {
      $project_ids = $this->entityTypeManager->getStorage('bb_project')
        ->getQuery()
        ->accessCheck(TRUE)
        ->execute();
      $project_handler = $this->entityTypeManager->getHandler('bb_project', 'query_access');
      assert($project_handler instanceof QueryAccessHandlerInterface);
      $project_conditions = $project_handler->getConditions('view', $account);
    }
    finally {
      $this->accountSwitcher->switchBack();
    }

    $conditions->addCacheableDependency($project_conditions);
    // shortcut: project IDs are materialized; use a subquery for large sets.
    if ($project_ids === [] || $project_conditions->isAlwaysFalse()) {
      return $conditions->alwaysFalse();
    }
    $conditions->addCondition('project_id', array_values($project_ids));
    return $conditions;
  }

}
