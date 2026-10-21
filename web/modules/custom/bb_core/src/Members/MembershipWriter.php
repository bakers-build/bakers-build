<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;

/**
 * Reads and writes a group's `og_membership` rows.
 *
 * The plain add/remove/role path of `GroupMembersForm`, kept apart to hold
 * the form under phpmd's coupling ceiling.
 */
final class MembershipWriter {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Creates an active membership for one account.
   *
   * Active, and with no role: the member role is required and is never
   * stored, so an addition states the membership and nothing else. A rank
   * is a separate, deliberate act on the item.
   */
  public function add(ContentEntityInterface $group, mixed $uid): void {
    if ($uid === NULL || $uid === '') {
      return;
    }
    $account = $this->entityTypeManager->getStorage('user')->load($uid);
    if ($account === NULL) {
      return;
    }
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($account)
      ->setGroup($group)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * Deletes the membership one remove names.
   */
  public function remove(ContentEntityInterface $group, int $uid): void {
    $membership = $this->membershipOf($group, $uid);
    if ($membership !== NULL) {
      $membership->delete();
    }
  }

  /**
   * Writes the role one pick names.
   *
   * A value the group does not offer writes nothing. This is what keeps a
   * forged pick from reaching a rank that is not on this surface.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The submitted account id.
   * @param string $value
   *   The submitted role value.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The group's assignable roles, keyed by role name.
   */
  public function writeRole(ContentEntityInterface $group, int $uid, string $value, array $roles): void {
    $membership = $this->membershipOf($group, $uid);
    if ($membership === NULL || !isset($roles[$value])) {
      return;
    }
    $role = $roles[$value];
    $standard = $role->getRoleType() === OgRoleInterface::ROLE_TYPE_STANDARD;
    // The member role stores an EMPTY array, because it is required:
    // keeping it would be storing a default that `getRoles()` prepends
    // anyway, and `OgMembership::preSave()` revokes it regardless.
    $membership->setRoles($standard ? [$role] : [])->save();
  }

  /**
   * Every membership of this group.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   *
   * @return array<int, \Drupal\og\OgMembershipInterface>
   *   The memberships.
   */
  public function memberships(ContentEntityInterface $group): array {
    $storage = $this->entityTypeManager->getStorage('og_membership');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', $group->getEntityTypeId())
      ->condition('entity_id', (string) $group->id())
      ->sort('created')
      ->execute();
    return array_filter(
      $storage->loadMultiple($ids),
      static fn ($membership): bool => $membership instanceof OgMembershipInterface,
    );
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
  public function membershipOf(ContentEntityInterface $group, int $uid): ?OgMembershipInterface {
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
