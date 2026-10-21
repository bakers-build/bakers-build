<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Session\AccountInterface;

/**
 * Resolves the id sets a bakers.build read scope is built from.
 *
 * Four questions, all answered per account and memoised for the request, so ten
 * entity types asking cost one resolution.
 */
interface BbWorkspaceReadScopeInterface {

  /**
   * Returns the workspaces the account holds an active membership in.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve.
   *
   * @return array<int>
   *   The bb_workspace entity ids, ascending.
   */
  public function workspaceIds(AccountInterface $account): array;

  /**
   * Returns the projects the account may read.
   *
   * The union of the projects of its teams and every project of the
   * workspaces where it holds a see-all role.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve.
   *
   * @return array<int>
   *   The bb_project entity ids, ascending.
   */
  public function projectIds(AccountInterface $account): array;

  /**
   * Returns the projects whose rows the account may see AGGREGATE figures for.
   *
   * Every project of every workspace the account belongs to, plus
   * ::projectIds(). Deliberately wider than ::projectIds(): a count is a
   * workspace-level aggregate, so a non-zero total beside an empty ticket list
   * is intended. Memoised separately so ordinary collection queries do not pay
   * the extra query.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve.
   *
   * @return array<int>
   *   The bb_project entity ids, ascending.
   */
  public function workspaceProjectIds(AccountInterface $account): array;

  /**
   * Returns the user ids the account may read.
   *
   * Always contains the account's own id. A person who cannot see themselves
   * breaks their own profile, author rendering and every `include` that
   * resolves back to them.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve.
   *
   * @return array<int>
   *   The user ids, ascending.
   */
  public function peopleIds(AccountInterface $account): array;

  /**
   * Returns the groups whose MEMBERSHIPS the account may read, per group type.
   *
   * Keyed by group type because `og_membership` anchors on the pair
   * (`entity_type`, `entity_id`) and each group type has its own id sequence;
   * a flat union would expose colliding foreign ids. Teams derive from the
   * workspace set, so a roster is readable exactly when the team is. The
   * account's own memberships are granted separately, as owner. Memoised
   * separately, like ::workspaceProjectIds().
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve.
   *
   * @return array<string, array<int>>
   *   The group entity ids, ascending, keyed by group entity type id. A type
   *   whose set is empty is still present, with an empty list.
   */
  public function membershipGroupIds(AccountInterface $account): array;

  /**
   * Drops the memoised sets, so the next question re-resolves them.
   *
   * OG's own upsert resolves the scope before writing a membership, so the
   * membership hooks call this after every write; otherwise the rest of the
   * request reads a stale, empty scope.
   *
   * @param int|null $uid
   *   The account to forget, or NULL for every account.
   */
  public function reset(?int $uid = NULL): void;

  /**
   * Whether the account bypasses the read scope for an entity type.
   *
   * Asked as a permission check, never by reading a condition group's shape:
   * `buildConditions()` returns an empty group both for a holder of the type's
   * admin permission and for a holder of `view <type>`, so the shape cannot
   * tell the two apart.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   * @param string $entity_type_id
   *   The entity type whose admin permission decides.
   *
   * @return bool
   *   TRUE when the account must not be narrowed.
   */
  public function isBypassed(AccountInterface $account, string $entity_type_id): bool;

}
