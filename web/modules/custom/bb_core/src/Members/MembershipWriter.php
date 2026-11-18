<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\og\Entity\OgMembership;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * Reads and writes a group's `og_membership` rows.
 *
 * The plain add/remove/role path of `GroupMembersForm`, kept apart to hold
 * the form under phpmd's coupling ceiling.
 */
final class MembershipWriter {

  /**
   * The rank that holds a workspace in charge, labelled Admin.
   */
  private const string LEAD = 'lead';

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
    if ($membership !== NULL && $this->refusal($group, $uid) === NULL) {
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
    if ($membership === NULL || !isset($roles[$value]) || $this->refusal($group, $uid, $value) !== NULL) {
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
   * Why a removal, or a pick of `$value`, may not touch this member.
   *
   * A workspace keeps its owner and at least one admin (`lead`) in charge.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The member's account id.
   * @param string|null $value
   *   The picked role name, or NULL for a removal.
   *
   * @return \Drupal\Core\StringTranslation\TranslatableMarkup|null
   *   The reason, or NULL when the change may go ahead.
   */
  public function refusal(ContentEntityInterface $group, int $uid, ?string $value = NULL): ?TranslatableMarkup {
    $membership = $this->membershipOf($group, $uid);
    if ($group->getEntityTypeId() !== 'bb_workspace' || $value === self::LEAD || $membership === NULL) {
      return NULL;
    }
    if ($group instanceof EntityOwnerInterface && (int) $group->getOwnerId() === $uid) {
      return new TranslatableMarkup('The owner of this workspace cannot be removed or demoted.');
    }
    $leads = array_filter($this->memberships($group), fn (OgMembershipInterface $seat): bool => $this->isLead($seat));
    if ($this->isLead($membership) && count($leads) <= 1) {
      return new TranslatableMarkup('The last admin of this workspace cannot be removed or demoted.');
    }
    return NULL;
  }

  /**
   * Whether an active membership holds the lead rank.
   */
  private function isLead(OgMembershipInterface $membership): bool {
    if (!$membership->isActive()) {
      return FALSE;
    }
    foreach ($membership->getRoles() as $role) {
      if ($role->getName() === self::LEAD) {
        return TRUE;
      }
    }
    return FALSE;
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

  /**
   * Each member's team names in this workspace, joined for the Team column.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The workspace.
   *
   * @return array<int, string>
   *   Comma-joined team labels in name order, keyed by user id.
   */
  public function teamNamesByMember(ContentEntityInterface $group): array {
    // The team type is the one an invitation names, which keeps this class
    // blind to group types.
    $team_type = (string) BbInvite::create([])->getFieldDefinition('team_id')?->getSetting('target_type');
    $teams = $this->entityTypeManager->getStorage($team_type)->loadByProperties(['workspace_id' => $group->id()]);
    if ($teams === []) {
      return [];
    }
    uasort($teams, static fn ($a, $b): int => strnatcasecmp((string) $a->label(), (string) $b->label()));
    $order = array_flip(array_map('strval', array_keys($teams)));
    $memberships = $this->entityTypeManager->getStorage('og_membership')->loadByProperties([
      'entity_type' => $team_type,
      'entity_id' => array_keys($teams),
      'state' => OgMembershipInterface::STATE_ACTIVE,
    ]);
    $names = [];
    foreach (array_filter($memberships, static fn ($m): bool => $m instanceof OgMembershipInterface) as $membership) {
      $team_id = (string) $membership->getGroupId();
      $names[(int) $membership->getOwnerId()][$order[$team_id]] = (string) $teams[$team_id]->label();
    }
    array_walk($names, 'ksort');
    return array_map(static fn (array $labels): string => implode(', ', $labels), $names);
  }

}
