<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Session\SessionManagerInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\UserInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Field declaration and invariant guards for workspace service accounts.
 *
 * A service account is a user carrying a nonempty `bb_service_workspace`
 * reference. This class is the single owner of every invariant that makes
 * that marker trustworthy: once set it cannot change, a marked user can
 * hold no site roles/email/password, cannot be deleted, and its OG
 * memberships cannot escape the role/group allowlist the spec fixes
 * (workspace Guest/Contributor, team Member/Reporter, one workspace only,
 * teams only inside that workspace). Entity validation covers the UI/API
 * paths; these presave/predelete guards are the fail-closed layer that also
 * rejects a direct `->save()` that skips validation.
 */
final class ServiceAccountHooks {

  /**
   * The workspace OG rank a service account may hold, besides implicit Member.
   */
  private const string WORKSPACE_GUEST_ROLE = 'bb_workspace-bb_workspace-guest';

  private const string WORKSPACE_CONTRIBUTOR_ROLE = 'bb_workspace-bb_workspace-contributor';

  /**
   * The team OG rank a service account may hold, besides implicit Member.
   */
  private const string TEAM_REPORTER_ROLE = 'bb_team-bb_team-reporter';

  public function __construct(
    private readonly ServiceAccountManager $serviceAccountManager,
    private readonly SessionManagerInterface $sessionManager,
    private readonly AccountProxyInterface $currentUser,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Implements hook_entity_base_field_info().
   *
   * Nullable, single-value, non-translatable reference on the `user` entity.
   * NULL means an ordinary human; installs get the storage from this
   * definition automatically.
   *
   * @return array<string, \Drupal\Core\Field\BaseFieldDefinition>
   *   The base field definitions this hook adds.
   */
  #[Hook('entity_base_field_info')]
  public function entityBaseFieldInfo(EntityTypeInterface $entity_type): array {
    if ($entity_type->id() !== 'user') {
      return [];
    }

    $fields = [];
    $fields[ServiceAccountManager::MARKER_FIELD] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Service account workspace'))
      ->setDescription(new TranslatableMarkup('Nonempty marks this user as a non-human service account bound to exactly one workspace. Immutable once set.'))
      ->setSetting('target_type', 'bb_workspace')
      ->setCardinality(1)
      ->setTranslatable(FALSE)
      ->setRevisionable(FALSE)
      ->setDisplayConfigurable('view', FALSE)
      ->setDisplayConfigurable('form', FALSE);

    return $fields;
  }

  /**
   * Implements hook_user_presave().
   *
   * Fail-closed order: the immutability check runs first and unconditionally
   * (it must also catch an attempt to CLEAR the marker), then the
   * service-account-only invariants run only when the field is actually set.
   */
  #[Hook('user_presave')]
  public function userPresave(UserInterface $user): void {
    $field = ServiceAccountManager::MARKER_FIELD;
    $workspaceTarget = $user->get($field)->target_id;
    $original = $user->original ?? NULL;

    if ($original instanceof UserInterface) {
      $originalTarget = $original->get($field)->target_id;
      if ($originalTarget !== $workspaceTarget) {
        throw new EntityStorageException('The service account workspace binding cannot be changed once set.');
      }
    }

    if ($workspaceTarget === NULL) {
      return;
    }

    // Status is also immutable through this ordinary save path.
    // `ServiceAccountManager::disable()` is the sole privileged exception:
    // it marks its own save `setSyncing(TRUE)` — core's own signal for a
    // trusted internal write — so this guard still rejects a block/unblock
    // reached through the user edit form, the bulk action or a generic API
    // write, while the one legitimate lifecycle path through the manager
    // still goes through this same presave, not around it.
    if (
      $original instanceof UserInterface
      && (bool) $original->isActive() !== (bool) $user->isActive()
      && !$user->isSyncing()
    ) {
      throw new EntityStorageException('A service account cannot change status through ordinary user administration.');
    }

    if ((string) $user->getEmail() !== '') {
      throw new EntityStorageException('A service account cannot have an email address.');
    }
    if ((string) $user->get('pass')->value !== '') {
      throw new EntityStorageException('A service account cannot have a usable password.');
    }
    if ($user->getRoles(TRUE) !== []) {
      throw new EntityStorageException('A service account cannot hold site-wide Drupal roles.');
    }
  }

  /**
   * Implements hook_user_predelete().
   *
   * Disable is the sole application lifecycle operation;
   * ordinary user cancellation/deletion must never remove a service
   * account's row, because that would anonymize or orphan ticket authorship.
   */
  #[Hook('user_predelete')]
  public function userPredelete(UserInterface $user): void {
    if ($this->serviceAccountManager->isServiceAccount($user)) {
      throw new EntityStorageException('A service account cannot be deleted; disable it instead.');
    }
  }

  /**
   * Implements hook_user_login().
   *
   * THE ONE SHARED CHOKEPOINT, rather than a guard in each caller. Core's
   * `UserLoginForm`, the one-time-login controllers
   * (`BbSignupClaimController`, `BbCodeForm`, core's own
   * password-reset login) and `social_auth`'s
   * `UserAuthenticator` (which backs `VerifiedEmailAuthenticator` and
   * `IdentityLink`) all end an interactive sign-in by calling core's
   * `user_login_finalize()`, and that function is what invokes this hook —
   * so this single implementation covers every one of them without a guard
   * copied into each. Bearer/OAuth authentication never calls
   * `user_login_finalize()` (`ApiKeyAuthenticationProvider` resolves the
   * account per request instead), so a service account's API key keeps
   * working; only an interactive SESSION is refused. The session is
   * destroyed and the request fails closed instead of silently continuing
   * as an authenticated service identity.
   */
  #[Hook('user_login')]
  public function userLogin(UserInterface $account): void {
    if (!$this->serviceAccountManager->isServiceAccount($account)) {
      return;
    }
    $this->sessionManager->destroy();
    $this->currentUser->setAccount(new AnonymousUserSession());
    throw new AccessDeniedHttpException('A service account cannot sign in interactively.');
  }

  /**
   * Implements hook_bb_core_member_roles_alter().
   *
   * `MemberItemBuilder` (in `bb_core`, which names no entity type) calls
   * this to narrow the roles ONE row may be assigned; an ordinary human row
   * is untouched. Mirrors the `ogMembershipPresave()` allowlist exactly, so
   * the Members surface never even offers a role the presave guard would
   * reject. Only an administrator of the account's workspace may change its
   * rank; anyone else (e.g. a team owner) is offered the current rank alone.
   *
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The group's full assignable-role set, keyed by bare role name.
   * @param array{membership: \Drupal\og\OgMembershipInterface, group: \Drupal\Core\Entity\ContentEntityInterface} $context
   *   The membership and group the row belongs to.
   */
  #[Hook('bb_core_member_roles_alter')]
  public function memberRolesAlter(array &$roles, array $context): void {
    $owner = $context['membership']->getOwner();
    if (!$owner instanceof UserInterface || !$this->serviceAccountManager->isServiceAccount($owner)) {
      return;
    }
    $allowed = match ($context['group']->getEntityTypeId()) {
      'bb_workspace' => ['guest', 'contributor'],
      'bb_team' => [OgRoleInterface::AUTHENTICATED, 'reporter'],
      default => [],
    };
    if ($this->serviceAccountManager->workspace($owner)?->access('update', $this->currentUser) !== TRUE) {
      $group = $context['group'];
      $current = $group instanceof BbWorkspaceInterface || $group instanceof BbTeamInterface ? $this->serviceAccountManager->roleName($group, $owner) : NULL;
      $allowed = array_intersect($allowed, [$current ?? OgRoleInterface::AUTHENTICATED]);
    }
    $roles = array_intersect_key($roles, array_flip($allowed));
  }

  /**
   * Implements hook_bb_core_account_menu_link_access_alter().
   *
   * A service account's user area has one page, its API keys: its
   * workspace administrator manages them there. Every other account page
   * (machines, conductors, time …) is hidden from that menu.
   *
   * @param \Drupal\Core\Access\AccessResult $access
   *   The narrowing result, neutral until a module forbids the link.
   * @param string $plugin_id
   *   The menu link plugin ID.
   * @param int $uid
   *   The viewed account.
   */
  #[Hook('bb_core_account_menu_link_access_alter')]
  public function accountMenuLinkAccessAlter(AccessResult &$access, string $plugin_id, int $uid): void {
    if ($plugin_id === 'bb_api_key.account.api_keys') {
      return;
    }
    $user = $this->entityTypeManager->getStorage('user')->load($uid);
    if ($user instanceof UserInterface && $this->serviceAccountManager->isServiceAccount($user)) {
      $access = AccessResult::forbidden('A service account has only an API keys page.')->addCacheableDependency($user);
    }
  }

  /**
   * Implements hook_views_data_alter().
   *
   * Without this, `ViewsHandlerManager::getHandler()` finds no `field`
   * definition for these plugin IDs on `users_field_data` and silently
   * falls back to the `Broken` handler — the row renders its name but every
   * one of these fields disappears, with no error and nothing in the
   * logs. See `ApiKeyHooks::viewsDataAlter()` for the identical pattern on
   * `consumer_field_data`.
   *
   * @param array<string, mixed> $data
   *   The Views data to alter.
   */
  #[Hook('views_data_alter')]
  public function viewsDataAlter(array &$data): void {
    if (!isset($data['users_field_data'])) {
      return;
    }
    $data['users_field_data']['bb_service_account_membership'] = [
      'title' => new TranslatableMarkup('Service account membership'),
      'help' => new TranslatableMarkup('Workspace role and team (team role) summary.'),
      'field' => ['id' => 'bb_service_account_membership'],
    ];
    $data['users_field_data']['bb_service_account_keys'] = [
      'title' => new TranslatableMarkup('Service account keys'),
      'help' => new TranslatableMarkup('Managed key metadata, one line per key.'),
      'field' => ['id' => 'bb_service_account_keys'],
    ];
    $data['users_field_data']['bb_service_account_actions'] = [
      'title' => new TranslatableMarkup('Service account actions'),
      'help' => new TranslatableMarkup('Status, Manage API keys and Disable, as a row action menu.'),
      'field' => ['id' => 'bb_service_account_actions'],
    ];
  }

  /**
   * Implements hook_entity_base_field_info_alter().
   *
   * A service account authenticates and posts as itself; it must never be
   * able to claim a different author by supplying a foreign
   * `owner_user_id`. This runs as a field constraint (not a presave guard)
   * so a spoofed owner surfaces as an ordinary 422 JSON:API validation
   * error, the same shape as every other rejected write, instead of an
   * uncaught storage exception.
   *
   * @param array<string, \Drupal\Core\Field\BaseFieldDefinition> $fields
   *   The entity type's base field definitions, by field name.
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type being altered.
   */
  #[Hook('entity_base_field_info_alter')]
  public function entityBaseFieldInfoAlter(array &$fields, EntityTypeInterface $entity_type): void {
    if ($entity_type->id() === 'bb_ticket' && isset($fields['owner_user_id'])) {
      $fields['owner_user_id']->addConstraint('BbServiceAccountTicketOwner');
    }
  }

  /**
   * Implements hook_og_membership_presave().
   *
   * Only constrains a membership whose owner is a service account; an
   * ordinary human membership is untouched. Rejects: a second workspace for
   * the same account, a team outside that one workspace, and any OG rank
   * outside the service-account allowlist (workspace Guest/Contributor,
   * team Member/Reporter) — including Lead/Owner/Admin and a role from the
   * wrong group type, however the membership was written (form, invite,
   * generic API or a direct `->save()`).
   */
  #[Hook('og_membership_presave')]
  public function ogMembershipPresave(OgMembershipInterface $membership): void {
    $account = $membership->getOwnerId() ? $membership->getOwner() : NULL;
    if (!$account instanceof UserInterface || !$this->serviceAccountManager->isServiceAccount($account)) {
      return;
    }

    $groupEntityType = $membership->getGroupEntityType();
    $groupId = (int) $membership->getGroupId();
    $workspaceId = (int) $this->serviceAccountManager->workspaceId($account);
    $roleIds = array_map('strval', array_column($membership->get('roles')->getValue(), 'target_id'));

    if ($groupEntityType === 'bb_workspace') {
      if ($groupId !== $workspaceId) {
        throw new EntityStorageException('A service account can only belong to its own workspace.');
      }
      $this->assertRolesAllowed($roleIds, [self::WORKSPACE_GUEST_ROLE, self::WORKSPACE_CONTRIBUTOR_ROLE], 'workspace');
      if (count(array_unique($roleIds)) > 1) {
        throw new EntityStorageException('A service account holds one workspace rank only.');
      }
      return;
    }

    if ($groupEntityType === 'bb_team') {
      $team = $membership->getGroup();
      $teamWorkspaceId = $team instanceof ContentEntityInterface
        ? (int) $team->get('workspace_id')->target_id
        : 0;
      if ($teamWorkspaceId !== $workspaceId) {
        throw new EntityStorageException('A service account can only join a team inside its own workspace.');
      }
      $this->assertRolesAllowed($roleIds, [self::TEAM_REPORTER_ROLE], 'team');
      $this->assertTeamWriteByWorkspaceAdministrator($membership, $account, $roleIds);
      return;
    }

    throw new EntityStorageException('A service account cannot join this group type.');
  }

  /**
   * Rejects a team join or rank change not made by the workspace admin.
   *
   * Team administration alone must not widen a service account's reach.
   * Anonymous writes pass: no route reaches a membership write anonymously,
   * so they come from CLI, install or other trusted system code.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The team membership being saved.
   * @param \Drupal\user\UserInterface $account
   *   The service account owning it.
   * @param array<int, string> $roleIds
   *   Role IDs assigned on the membership.
   */
  private function assertTeamWriteByWorkspaceAdministrator(OgMembershipInterface $membership, UserInterface $account, array $roleIds): void {
    if ($membership->isSyncing() || $this->currentUser->isAnonymous()) {
      return;
    }
    $original = $membership->isNew() ? NULL : $membership->getOriginal();
    if ($original instanceof OgMembershipInterface) {
      $originalRoleIds = array_map('strval', array_column($original->get('roles')->getValue(), 'target_id'));
      sort($originalRoleIds);
      sort($roleIds);
      if ($originalRoleIds === $roleIds) {
        return;
      }
    }
    if ($this->serviceAccountManager->workspace($account)?->access('update', $this->currentUser) !== TRUE) {
      throw new EntityStorageException("Only the service account's workspace administrator may add it to a team or change its team rank.");
    }
  }

  /**
   * Rejects any role ID outside the allowed set.
   *
   * @param array<int, string> $roleIds
   *   Role IDs assigned on the membership.
   * @param array<int, string> $allowed
   *   Role IDs permitted for a service account on this group type.
   * @param string $groupLabel
   *   Human-readable group type label for the exception message.
   */
  private function assertRolesAllowed(array $roleIds, array $allowed, string $groupLabel): void {
    foreach ($roleIds as $roleId) {
      if (!in_array($roleId, $allowed, TRUE)) {
        throw new EntityStorageException("A service account cannot hold the '$roleId' $groupLabel role.");
      }
    }
  }

}
