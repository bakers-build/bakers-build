<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\og\OgMembershipAccessControlHandler;
use Drupal\og\OgMembershipInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Makes an og_membership readable inside bakers.build's read scope.
 *
 * Only `view` is widened, and it needs both `view bakers memberships` and a row
 * inside the account's read scope (or owned by it), the same bound the
 * collection query applies. Every other operation, and field access, is OG's
 * answer unchanged. `administer bakers` bypasses, matching the query rule.
 *.
 *
 * @see \Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber
 * @see bb_core_entity_type_alter()
 */
final class BbOgMembershipAccessControlHandler extends OgMembershipAccessControlHandler {

  /**
   * The bakers.build-owned permission that makes a membership readable at all.
   *
   * Named `<verb> bakers <noun>` so it does not read as OG's own permission.
   */
  public const VIEW_PERMISSION = 'view bakers memberships';

  /**
   * The bakers.build-wide bypass, which og_membership otherwise would not honour.
   */
  public const ADMIN_PERMISSION = 'administer bakers';

  /**
   * The read scope this handler bounds a row against.
   */
  protected BbWorkspaceReadScopeInterface $readScope;

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type) {
    /** @var self $instance */
    $instance = new static(
      $entity_type,
      $container->get('og.access'),
      $container->get('og.membership_manager'),
      $container->get('og.context'),
    );
    $instance->readScope = $container->get('bb_core.workspace_read_scope');

    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $membership, $operation, AccountInterface $account): AccessResultInterface {
    $parent = parent::checkAccess($membership, $operation, $account);
    // A read-only widening: every other operation is OG's answer verbatim, and
    // an already-decided `view` (the OG admin, an in-group manager) is too.
    if ($operation !== 'view' || !$parent->isNeutral()) {
      return $parent;
    }

    $admin = AccessResult::allowedIfHasPermission($account, self::ADMIN_PERMISSION);
    if ($admin->isAllowed()) {
      return $admin->orIf($parent);
    }

    // `andIf`, so the permission alone never grants and the scope alone never
    // does either. Neutral rather than forbidden when one half is missing: a
    // forbidden result would win over every other module's opinion, and the
    // question here is only whether bakers.build grants.
    return AccessResult::allowedIfHasPermission($account, self::VIEW_PERMISSION)
      ->andIf(AccessResult::allowedIf($this->isInReadScope($membership, $account)))
      // The answer depends on the account's memberships, so it varies per user
      // and dies with any membership write. Both, and on the ALLOW as well as
      // the deny: tagging only the denial would leave an allow cached past the
      // moment the membership that justified it was revoked.
      ->addCacheContexts(['user'])
      ->addCacheTags(['og_membership_list'])
      ->addCacheableDependency($parent);
  }

  /**
   * Whether this membership's group is one the account may read members of.
   *
   * @param \Drupal\Core\Entity\EntityInterface $membership
   *   The membership row.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account asking.
   *
   * @return bool
   *   TRUE when the row is the account's own, or its group is in scope.
   */
  private function isInReadScope(EntityInterface $membership, AccountInterface $account): bool {
    if (!$membership instanceof OgMembershipInterface) {
      return FALSE;
    }
    // The account's OWN row, whatever the group. A person who cannot read the
    // membership that grants them their rank cannot see why they may do what
    // they may do, and OG's own resolution asks this question constantly.
    // Mirrors the owner term the collection rule carries, so the two agree.
    if ((int) $membership->getOwnerId() === (int) $account->id() && (int) $account->id() !== 0) {
      return TRUE;
    }
    $groups = $this->readScope->membershipGroupIds($account);
    // getGroupId() answers a STRING; the resolved sets are integers.
    return in_array(
      (int) $membership->getGroupId(),
      $groups[$membership->getGroupEntityType()] ?? [],
      TRUE,
    );
  }

}
