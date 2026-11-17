<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityHandlerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbProfileInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The owner views and edits a profile; members of its workspace view it.
 *
 * `administer bakers` bypasses (parent). A workspace lead's edit of a service
 * account's profile is granted by bb_api_key. Delete is admin only.
 */
final class BbProfileAccessControlHandler extends EntityAccessControlHandler implements EntityHandlerInterface {

  /**
   * Resolves the workspaces an account belongs to.
   */
  private BbWorkspaceReadScopeInterface $readScope;

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    $handler = new static($entity_type);
    $handler->readScope = $container->get('bb_core.workspace_read_scope');
    return $handler;
  }

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    $parent = parent::checkAccess($entity, $operation, $account);
    if (!$parent->isNeutral() || !$entity instanceof BbProfileInterface || !in_array($operation, ['view', 'update'], TRUE)) {
      return $parent;
    }
    $own = AccessResult::allowedIf($account->isAuthenticated() && (int) $entity->getOwnerId() === (int) $account->id())
      ->cachePerUser()->addCacheableDependency($entity);
    if ($operation === 'update' || $own->isAllowed()) {
      return $own;
    }
    // As readable as the person's name on the workspace's member screens.
    $member = in_array($entity->workspaceId(), $this->readScope->workspaceIds($account), TRUE);
    return AccessResult::allowedIf($member)
      ->andIf($entity->getOwner()->access('view', $account, TRUE))
      ->addCacheTags(['og_membership_list'])
      ->inheritCacheability($own);
  }

  /**
   * {@inheritdoc}
   *
   * Only an administrator moves a profile to another user or workspace; an
   * owner doing so would plant text in another person's run context.
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    $result = parent::checkFieldAccess($operation, $field_definition, $account, $items);
    if ($operation === 'edit' && in_array($field_definition->getName(), ['uid', 'workspace_id'], TRUE)) {
      return AccessResult::forbiddenIf(!$account->hasPermission('administer bakers'), 'Only an administrator reassigns a profile.')
        ->cachePerPermissions()->orIf($result);
    }
    return $result;
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    // Profiles are created by their owner's form and updates, never directly.
    return AccessResult::allowedIfHasPermission($account, 'administer bakers');
  }

}
