<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Answers what an account's OG ranks grant it, and where.
 *
 * The questions below are the whole seam between the two rank layers. Layer
 * A asks the first one — the tenant-blind union it projects into the
 * account's permission set. Layer B asks the other two, in that order: an
 * account that holds the permission site-wide is never fenced, and only what
 * is left is compared against the row's own groups.
 */
interface BbRankCapabilityInterface {

  /**
   * The union of every permission on every rank the account holds.
   *
   * Deliberately tenant-blind: it answers "may this account do X at all", which
   * is what keeps EntityPermissionProvider, QueryAccessHandlerBase, route
   * `_permission` requirements and JSON:API working unchanged. Fencing it back
   * to the granting group is BbRankEntityFence's job.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve.
   *
   * @return array<string>
   *   The sorted, unique permission names, empty when the account holds no
   *   membership.
   */
  public function rankPermissions(AccountInterface $account): array;

  /**
   * Drops the memoised permission union of one account, or of every account.
   *
   * Called when memberships change, so the rest of the request does not read
   * the ranks the account held before.
   *
   * @param int|null $uid
   *   The account whose memo to drop, or NULL for all of them.
   */
  public function reset(?int $uid = NULL): void;

  /**
   * Whether a site-wide user_role grants the account the permission.
   *
   * Deliberately NOT `$account->hasPermission()`: that routes through
   * `permission_checker`, which asks the very access policy this method exists
   * to fence, so every rank-derived permission would report as site-wide and
   * Layer B would never forbid anything.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   * @param string $permission
   *   The permission name.
   *
   * @return bool
   *   TRUE when a user_role the account holds grants it, or is an admin role.
   */
  public function hasSiteWidePermission(AccountInterface $account, string $permission): bool;

  /**
   * Whether this account is an instance admin for field and lifecycle policy.
   *
   * Cookie uid 1 follows `%security.enable_super_user%`; otherwise a
   * site-wide `administer bakers` role. A user-bound token uses
   * hasSiteWidePermission() (narrowed roles), not hasPermission() — uid 1's
   * isAdmin flag survives Oauth2AccessPolicy, so a bb:session token would
   * otherwise inherit the bypass. JSON:API and injected current_user pass
   * AccountProxy; the implementation unwraps it so the token check sees
   * TokenAuthUserInterface.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account asking.
   *
   * @return bool
   *   TRUE when the account may skip the saved-row allowlist and take
   *   another owner's conductor offline.
   */
  public function isInstanceAdmin(AccountInterface $account): bool;

  /**
   * Whether the account holds the permission inside one specific group.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   * @param string $permission
   *   The permission name.
   * @param \Drupal\Core\Entity\EntityInterface $group
   *   The group — a bb_workspace or a bb_project.
   *
   * @return bool
   *   TRUE when OG allows it in that group.
   */
  public function hasGroupPermission(AccountInterface $account, string $permission, EntityInterface $group): bool;

  /**
   * Whether the account's OWN rank in one group grants the permission.
   *
   * Reads only the roles on the membership itself: `hasGroupPermission()`
   * allows the group owner via `group_manager_full_access`, and
   * `hasPermission()` answers a machine identity's scopes site-wide. Use it
   * when a permission must be earned by rank alone.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   * @param string $permission
   *   The permission name.
   * @param \Drupal\Core\Entity\EntityInterface $group
   *   The group — a bb_workspace or a bb_project.
   *
   * @return bool
   *   TRUE when a role on the account's own membership in that group grants
   *   the permission.
   */
  public function hasGroupRolePermission(AccountInterface $account, string $permission, EntityInterface $group): bool;

}
