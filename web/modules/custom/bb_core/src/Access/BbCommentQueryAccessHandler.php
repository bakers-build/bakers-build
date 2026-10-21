<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * Hides unpublished reviews from accounts that may not see them.
 *
 * The entity-module parent already restricts view to published rows (plus
 * own unpublished when that permission exists). Assigned reviewers still
 * need their drafts, and the current assignee needs submitted/rejected
 * rows, without granting `view own unpublished bb_comment`.
 */
final class BbCommentQueryAccessHandler extends QueryAccessHandler {

  /**
   * Constructs a BbCommentQueryAccessHandler.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    EntityTypeBundleInfoInterface $bundle_info,
    EventDispatcherInterface $event_dispatcher,
    AccountInterface $current_user,
    private readonly EntityTypeManagerInterface $entityTypeManager,
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
    );
  }

  /**
   * {@inheritdoc}
   */
  public function buildConditions($operation, AccountInterface $account): ConditionGroup {
    $conditions = parent::buildConditions($operation, $account);
    if ($operation !== 'view' || $account->hasPermission('administer bakers')) {
      return $conditions;
    }
    if (!$account->hasPermission('view bb_comment')) {
      return $conditions;
    }
    $own = new ConditionGroup('AND');
    $own->addCondition('author', $account->id());
    $own->addCondition('status', 0);
    $visible = new ConditionGroup('OR');
    if (!$conditions->isAlwaysFalse()) {
      $visible->addCondition($conditions);
    }
    $visible->addCondition($own);
    $assigned_ids = $this->assignedTicketIds($account);
    if ($assigned_ids !== []) {
      $pending = new ConditionGroup('AND');
      $pending->addCondition('review_state', ['submitted', 'rejected'], 'IN');
      $pending->addCondition('ticket_id', $assigned_ids, 'IN');
      $visible->addCondition($pending);
    }
    $visible->addCacheContexts(['user']);
    return $visible;
  }

  /**
   * Ticket ids currently assigned to the account.
   *
   * @return list<string>
   *   Storage ids of tickets whose assignee is this account.
   */
  private function assignedTicketIds(AccountInterface $account): array {
    return array_values($this->entityTypeManager->getStorage('bb_ticket')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('assignee_user_id', $account->id())
      ->execute());
  }

}
