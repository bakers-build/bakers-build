<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Access;

use Drupal\bb_core\Access\BbGroupScopedAccount;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * Restricts webhook listings to workspaces granting `view bb_webhook`.
 *
 * Single-level `workspace_id IN (…)`, so it maps on entity queries and Views.
 */
final class BbWebhookQueryAccessHandler extends QueryAccessHandler {

  /**
   * Constructs a BbWebhookQueryAccessHandler.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    EntityTypeBundleInfoInterface $bundle_info,
    EventDispatcherInterface $event_dispatcher,
    AccountInterface $current_user,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbWorkspaceReadScopeInterface $readScope,
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
      $container->get('entity_type.manager'),
      $container->get('bb_core.workspace_read_scope'),
      $container->get('bb_core.rank_capability'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function buildConditions($operation, AccountInterface $account): ConditionGroup {
    $conditions = new ConditionGroup('OR');
    $conditions->addCacheContexts(['user', 'user.permissions']);
    $conditions->addCacheTags(['og_membership_list']);
    $permission = $operation . ' bb_webhook';
    $granting = [];
    $workspaces = $this->entityTypeManager->getStorage('bb_workspace')->loadMultiple($this->readScope->workspaceIds($account));
    foreach ($workspaces as $id => $workspace) {
      if ((new BbGroupScopedAccount($account, [$workspace], $this->capability))->hasPermission($permission)) {
        $granting[] = (int) $id;
      }
    }
    if ($granting === []) {
      return $conditions->alwaysFalse();
    }
    return $conditions->addCondition('workspace_id', $granting);
  }

}
