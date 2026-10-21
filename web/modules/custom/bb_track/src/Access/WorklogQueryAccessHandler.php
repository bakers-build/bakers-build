<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandlerBase;
use Drupal\bb_track\WorklogScope;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * Narrows Worklog reads to the owner and led teams, writes to the owner.
 */
final class WorklogQueryAccessHandler extends QueryAccessHandlerBase {

  /**
   * Constructs the handler.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    EntityTypeBundleInfoInterface $bundle_info,
    EventDispatcherInterface $event_dispatcher,
    AccountInterface $current_user,
    private readonly WorklogScope $scope,
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
      $container->get('bb_track.worklog_scope'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function buildConditions($operation, AccountInterface $account): ConditionGroup {
    $conditions = new ConditionGroup('AND');
    $conditions->addCacheContexts(['user']);

    if ($account->isAnonymous()) {
      $conditions->alwaysFalse();
      return $conditions;
    }

    // $account->id() is passed verbatim so JSON:API filter-access identity
    // comparison keeps matching the owner condition.
    if ($this->entityType->id() === 'bb_track_submission') {
      $conditions->addCondition('owner_user_id', $account->id());
      return $conditions;
    }
    $conditions->addCondition('voided', 0);
    if (in_array($operation, ['update', 'delete'], TRUE)) {
      $conditions->addCondition('owner_user_id', $account->id());
      $conditions->addCondition('state', ['recorded', 'proposed'], 'IN');
      return $conditions;
    }
    $conditions->addCacheTags(['og_membership_list', 'bb_project_list']);
    $readable = new ConditionGroup('OR');
    $readable->addCondition('owner_user_id', $account->id());
    foreach ($this->scope->ledTeamScopes($account) as $team_scope) {
      if ($team_scope['owners'] === [] || $team_scope['projects'] === []) {
        continue;
      }
      $team = new ConditionGroup('AND');
      $team->addCondition('owner_user_id', $team_scope['owners'], 'IN');
      $team->addCondition('project_id', $team_scope['projects'], 'IN');
      $team->addCondition('state', ['recorded', 'approved'], 'IN');
      $readable->addCondition($team);
    }
    $conditions->addCondition($readable);
    return $conditions;
  }

}
