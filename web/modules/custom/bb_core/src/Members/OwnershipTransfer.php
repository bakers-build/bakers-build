<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\og\OgMembershipInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * Moves a group's ownership to one of its own active members.
 *
 * Kept apart from `GroupMembersForm` to hold it under phpmd's complexity
 * ceiling.
 *
 * GENERIC ON `EntityOwnerInterface`, never on an entity type. A group that
 * carries no owner offers no transfer at all, which is how a group type that
 * grants nothing says so without this file naming it.
 */
final class OwnershipTransfer {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Whether an account currently holds this group's ownership.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface|null $group
   *   The group, or NULL off a group route.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   *
   * @return bool
   *   TRUE when the account is the group's `owner_user_id`.
   */
  public function isOwner(?ContentEntityInterface $group, AccountInterface $account): bool {
    if (!$group instanceof EntityOwnerInterface) {
      return FALSE;
    }
    return (int) $group->getOwnerId() === (int) $account->id();
  }

  /**
   * Moves ownership to an existing active member, and demotes the previous.
   *
   * THE TARGET MUST ALREADY BE AN ACTIVE MEMBER: a submitted uid this group
   * holds no active membership for writes nothing, the same fence every
   * other write on the members surface already stands behind.
   *
   * THE PREVIOUS OWNER KEEPS THE HIGHEST STANDARD ROLE OFFERED, named by
   * `$leadRoleName` (`lead` today) rather than being left with none — there is
   * no `owner` OG role to fall back to. A group type offering no such role
   * writes nothing for that half, the same forgiving shape an unrecognised
   * role pick already has elsewhere on this surface.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The submitted target account id.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The group's assignable roles, keyed by name.
   * @param string $lead_role_name
   *   The role name the previous owner is left holding, when the group
   *   offers one.
   */
  public function transfer(ContentEntityInterface $group, int $uid, array $roles, string $lead_role_name): void {
    if (!$group instanceof EntityOwnerInterface) {
      return;
    }
    $target = $this->membershipOf($group, $uid);
    if ($target === NULL || $target->getState() !== OgMembershipInterface::STATE_ACTIVE) {
      return;
    }
    $previous_owner_id = (int) $group->getOwnerId();
    if ($previous_owner_id === $uid) {
      return;
    }
    $group->setOwnerId($uid);
    $group->save();

    $previous_owner_membership = $this->membershipOf($group, $previous_owner_id);
    if ($previous_owner_membership !== NULL && isset($roles[$lead_role_name])) {
      $previous_owner_membership->setRoles([$roles[$lead_role_name]])->save();
    }
  }

  /**
   * This group's membership for one account, if it holds one.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The account id.
   *
   * @return \Drupal\og\OgMembershipInterface|null
   *   The membership, or NULL.
   */
  private function membershipOf(ContentEntityInterface $group, int $uid): ?OgMembershipInterface {
    if ($uid <= 0) {
      return NULL;
    }
    $storage = $this->entityTypeManager->getStorage('og_membership');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', $group->getEntityTypeId())
      ->condition('entity_id', (string) $group->id())
      ->condition('uid', $uid)
      ->range(0, 1)
      ->execute();
    if ($ids === []) {
      return NULL;
    }
    $membership = $storage->load((string) reset($ids));
    return $membership instanceof OgMembershipInterface ? $membership : NULL;
  }

}
