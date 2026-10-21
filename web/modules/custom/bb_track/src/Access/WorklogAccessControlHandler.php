<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityHandlerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorklogScope;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Owner and team-lead read access for Worklog; owner-only writes.
 */
final class WorklogAccessControlHandler extends EntityAccessControlHandler implements EntityHandlerInterface {

  /**
   * Constructs the handler.
   *
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type definition.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface $readScope
   *   Workspace membership resolver.
   * @param \Drupal\bb_track\WorklogScope $scope
   *   Team-lead read policy.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbWorkspaceReadScopeInterface $readScope,
    private readonly WorklogScope $scope,
  ) {
    parent::__construct($entity_type);
  }

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    return new static(
      $entity_type,
      $container->get('entity_type.manager'),
      $container->get('bb_core.workspace_read_scope'),
      $container->get('bb_track.worklog_scope'),
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    $denied = AccessResult::forbidden()
      ->addCacheContexts(['user'])
      ->addCacheableDependency($entity);

    if (!$entity instanceof Worklog || $account->isAnonymous()) {
      return $denied;
    }
    if ($operation === 'view') {
      $readable = !$entity->get('voided')->value && $this->scope->canView($entity, $account);
      return ($readable ? AccessResult::allowed() : AccessResult::forbidden())
        ->addCacheContexts(['user'])
        ->addCacheTags(['og_membership_list'])
        ->addCacheableDependency($entity);
    }
    if ((int) $entity->getOwnerId() !== (int) $account->id() || $entity->get('voided')->value) {
      return $denied;
    }

    $allowed = AccessResult::allowed()
      ->addCacheContexts(['user'])
      ->addCacheableDependency($entity);

    if (!in_array($operation, ['update', 'delete'], TRUE)) {
      return $denied;
    }
    if (!in_array((string) $entity->get('state')->value, ['recorded', 'proposed'], TRUE)) {
      return $denied;
    }
    return $this->recordingAccess($entity, $account, $allowed, $denied);
  }

  /**
   * Retains existing project authority for editing recorded worklog.
   */
  private function recordingAccess(Worklog $entity, AccountInterface $account, AccessResult $allowed, AccessResult $denied): AccessResultInterface {
    $project = $entity->get('project_id')->entity;
    if (!$project instanceof BbProjectInterface) {
      return $allowed;
    }
    $rank = $denied
      ->addCacheContexts(['user.permissions'])
      ->addCacheTags(['og_membership_list']);
    if (!WorklogFormAccess::canRecordOnProject($account, $project)) {
      return $rank;
    }
    return $allowed
      ->addCacheContexts(['user.permissions'])
      ->addCacheTags(['og_membership_list']);
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    $denied = AccessResult::forbidden()
      ->addCacheContexts(['user', 'user.permissions'])
      ->addCacheTags(['og_membership_list']);
    if ($account->isAnonymous()) {
      return $denied;
    }
    $workspace_ids = $this->readScope->workspaceIds($account);
    if ($workspace_ids === []) {
      return $denied;
    }
    foreach ($workspace_ids as $workspace_id) {
      $workspace = $this->entityTypeManager->getStorage('bb_workspace')->load($workspace_id);
      if ($workspace instanceof BbWorkspaceInterface
        && WorklogFormAccess::canRecord($account, $workspace)) {
        return AccessResult::allowed()
          ->addCacheContexts(['user', 'user.permissions'])
          ->addCacheTags(['og_membership_list']);
      }
    }
    return $denied;
  }

}
