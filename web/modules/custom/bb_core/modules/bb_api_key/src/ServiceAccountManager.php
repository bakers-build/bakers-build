<?php

declare(strict_types=1);

namespace Drupal\bb_api_key;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountSwitcherInterface;
use Drupal\Core\Session\SessionManagerInterface;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\bb_core\Members\MembershipWriter;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\UserInterface;

/**
 * Identifies, creates and manages the lifecycle of service-account users.
 *
 * A service account is an ordinary Drupal user carrying a nonempty
 * `bb_service_workspace` reference (ServiceAccountHooks declares and
 * guards that field). `isServiceAccount()`/`workspaceId()`/`belongsTo()`
 * are the single place that reads the marker, so no caller re-implements
 * the emptiness check. `create()`, `issueKey()`, `revokeKey()` and
 * `disable()` cover the application lifecycle added on top of
 * `ApiKeyManager`'s key mechanics; `ogMembershipPresave()` in
 * `ServiceAccountHooks` is the fail-closed layer every one of these paths —
 * and any other write, however reached — still has to pass.
 */
final class ServiceAccountManager {

  /**
   * The field that marks a user as a service account.
   */
  public const string MARKER_FIELD = 'bb_service_workspace';

  /**
   * Workspace rank choices a service account's create form offers.
   *
   * Matches `assignableRoles()`'s bare-name keys and
   * `ServiceAccountHooks::ogMembershipPresave()`'s allowlist exactly.
   */
  private const array WORKSPACE_ROLE_IDS = ['guest', 'contributor'];

  /**
   * Team rank choices a service account's create form offers.
   */
  private const array TEAM_ROLE_IDS = ['member', 'reporter'];

  /**
   * Maximum attempts to generate a free username before giving up.
   *
   * Each attempt adds 32 bits of randomness; this many collisions in a row
   * is not a coincidence a retry should paper over.
   */
  private const int MAX_NAME_ATTEMPTS = 5;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
    private readonly LockBackendInterface $lock,
    private readonly SessionManagerInterface $sessionManager,
    private readonly ApiKeyManager $apiKeyManager,
    private readonly MembershipWriter $membershipWriter,
    private readonly AccountSwitcherInterface $accountSwitcher,
  ) {}

  /**
   * Whether this user is a workspace service account.
   */
  public function isServiceAccount(UserInterface $user): bool {
    return $this->workspaceId($user) !== NULL;
  }

  /**
   * The workspace this service account is bound to, or NULL for a human.
   */
  public function workspaceId(UserInterface $user): ?int {
    $field = $user->get(self::MARKER_FIELD);
    if ($field->isEmpty()) {
      return NULL;
    }
    return (int) $field->target_id;
  }

  /**
   * Whether this user is bound to the given workspace.
   */
  public function belongsTo(UserInterface $user, BbWorkspaceInterface $workspace): bool {
    return $this->workspaceId($user) === (int) $workspace->id();
  }

  /**
   * The workspace entity this service account is bound to, or NULL.
   */
  public function workspace(UserInterface $user): ?BbWorkspaceInterface {
    $id = $this->workspaceId($user);
    if ($id === NULL) {
      return NULL;
    }
    $workspace = $this->entityTypeManager->getStorage('bb_workspace')->load($id);
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

  /**
   * The one team this service account belongs to, or NULL.
   *
   * A service account holds exactly one team membership (`create()` writes
   * only one), so the first `bb_team` membership found is authoritative.
   * A direct `og_membership` query, not `MembershipManagerInterface`: this
   * class already injects `entity_type.manager`, and adding a second service
   * just to look up one row would only grow its dependency count.
   */
  public function team(UserInterface $user): ?BbTeamInterface {
    $membership = $this->membershipOf('bb_team', $user);
    $group = $membership?->getGroup();
    return $group instanceof BbTeamInterface ? $group : NULL;
  }

  /**
   * The bare role name this account holds in `$group`, or NULL for Member.
   *
   * For example 'guest' or 'reporter'; NULL means the implicit Member rank
   * alone.
   */
  public function roleName(BbWorkspaceInterface|BbTeamInterface $group, UserInterface $user): ?string {
    $membership = $this->membershipOf($group->getEntityTypeId(), $user, (int) $group->id());
    if ($membership === NULL) {
      return NULL;
    }
    foreach ($membership->getRoles() as $role) {
      if ($role->getRoleType() === OgRoleInterface::ROLE_TYPE_STANDARD) {
        return (string) $role->getName();
      }
    }
    return NULL;
  }

  /**
   * This user's single active membership of the given group type, or NULL.
   *
   * @param string $entityType
   *   The group's entity type id, e.g. 'bb_team'.
   * @param \Drupal\user\UserInterface $user
   *   The member.
   * @param int|null $entityId
   *   A specific group id to match, or NULL for any group of that type.
   */
  private function membershipOf(string $entityType, UserInterface $user, ?int $entityId = NULL): ?OgMembershipInterface {
    $storage = $this->entityTypeManager->getStorage('og_membership');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('uid', $user->id())
      ->condition('entity_type', $entityType)
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->range(0, 1);
    if ($entityId !== NULL) {
      $query->condition('entity_id', (string) $entityId);
    }
    $ids = $query->execute();
    if ($ids === []) {
      return NULL;
    }
    $membership = $storage->load(reset($ids));
    return $membership instanceof OgMembershipInterface ? $membership : NULL;
  }

  /**
   * Atomically creates a service account, its memberships and its first key.
   *
   * One DB transaction covers the user, both memberships and the key: a
   * failure at any step — including an invalid role choice or a key-save
   * failure — rolls every one of them back, so a half-created identity
   * never lingers for a retry to collide with. `$workspaceRoleId` and
   * `$teamRoleId` are the bare names `assignableRoles()` and the Members
   * surface already use ('guest'/'contributor', 'member'/'reporter');
   * `ogMembershipPresave()` still rejects anything else as the fail-closed
   * layer, but validating here first gives the form a clean error instead
   * of an entity-storage exception. `$keyLabel` names the first key (e.g.
   * "GitLab E2E"); empty falls back to the account name.
   *
   * @return array{user: \Drupal\user\UserInterface, consumer: \Drupal\consumers\Entity\ConsumerInterface, secret: string}
   *   The created account, its first managed key, and the one-time secret.
   *
   * @throws \InvalidArgumentException
   *   When the name, a role choice, or the expiry date is invalid.
   */
  public function create(
    BbWorkspaceInterface $workspace,
    BbTeamInterface $team,
    string $name,
    string $workspaceRoleId,
    string $teamRoleId,
    string $expiryDate,
    AccountInterface $actor,
    string $keyLabel = '',
  ): array {
    if (!$workspace->access('update', $actor)) {
      throw new \InvalidArgumentException('The acting account does not administer this workspace.');
    }
    if (!in_array($workspaceRoleId, self::WORKSPACE_ROLE_IDS, TRUE)) {
      throw new \InvalidArgumentException("'$workspaceRoleId' is not a workspace role a service account may hold.");
    }
    if (!in_array($teamRoleId, self::TEAM_ROLE_IDS, TRUE)) {
      throw new \InvalidArgumentException("'$teamRoleId' is not a team role a service account may hold.");
    }
    // FAILS CLOSED BEFORE ANY WRITE: a malformed/out-of-range expiry must
    // never leave a user and memberships behind with no key to show for it.
    $expires = $this->apiKeyManager->expiryTimestamp($expiryDate);
    // Fail closed on missing role config: writeRole() would silently skip it.
    if (!isset(MemberItemBuilder::assignableRoles($workspace)[$workspaceRoleId], MemberItemBuilder::assignableRoles($team)[$teamRoleId])) {
      throw new \InvalidArgumentException('A service-account role is not configured on this site.');
    }

    $transaction = $this->database->startTransaction();
    try {
      $user = $this->createUser($name, $workspace);

      $this->membershipWriter->add($workspace, $user->id());
      $this->membershipWriter->writeRole($workspace, (int) $user->id(), $workspaceRoleId, MemberItemBuilder::assignableRoles($workspace));

      $this->membershipWriter->add($team, $user->id());
      $this->membershipWriter->writeRole($team, (int) $user->id(), $teamRoleId, MemberItemBuilder::assignableRoles($team));

      $issued = $this->asServiceUser($user, fn (): array => $this->apiKeyManager->create($user, $this->keyLabel($keyLabel, $user), $expires));

      return ['user' => $user, 'consumer' => $issued['consumer'], 'secret' => $issued['secret']];
    }
    catch (\Throwable $error) {
      $transaction->rollBack();
      throw $error;
    }
  }

  /**
   * Issues an additional key for an existing, active service account.
   *
   * Locked per-user with `disable()`, so a key cannot be minted for an
   * account `disable()` has concurrently blocked: whichever call acquires
   * the lock first runs to completion before the other re-reads the
   * account's current status. `$label` names the key; empty falls back to
   * the account name.
   *
   * @return array{consumer: \Drupal\consumers\Entity\ConsumerInterface, secret: string}
   *   The new managed key and its one-time secret.
   *
   * @throws \InvalidArgumentException
   *   When the account is not an active service account, or the actor does
   *   not administer its workspace.
   */
  public function issueKey(UserInterface $user, string $expiryDate, AccountInterface $actor, string $label = ''): array {
    $expires = $this->apiKeyManager->expiryTimestamp($expiryDate);
    return $this->withUserLock((int) $user->id(), function () use ($user, $expires, $actor, $label): array {
      $user = $this->reload($user);
      $this->assertManageable($user, $actor);
      if ($user->isBlocked()) {
        throw new \InvalidArgumentException('A disabled service account cannot be issued a key.');
      }
      return $this->asServiceUser($user, fn (): array => $this->apiKeyManager->create($user, $this->keyLabel($label, $user), $expires));
    });
  }

  /**
   * A key's label: the one given, or the account name.
   */
  private function keyLabel(string $label, UserInterface $user): string {
    return trim($label) !== '' ? $label : $user->getAccountName();
  }

  /**
   * Revokes one managed key belonging to a service account.
   *
   * Reuses `ApiKeyManager::revoke()`, whose consumer delete synchronously
   * revokes every token it issued (`ApiKeyHooks::entityDelete()`) — nothing
   * extra is needed here for the single-key case; `disable()` below covers
   * every key at once.
   *
   * @throws \InvalidArgumentException
   *   When the account is not a service account, the actor does not
   *   administer its workspace, or the key does not belong to this account.
   */
  public function revokeKey(UserInterface $user, ConsumerInterface $consumer, AccountInterface $actor): void {
    $this->assertManageable($user, $actor);
    $this->apiKeyManager->revoke($consumer, $user);
  }

  /**
   * Fail-closed, idempotent disable: the sole application lifecycle action.
   *
   * Blocks the account FIRST, before any fallible cleanup, so a failure
   * midway through never leaves an active account with a live key — the
   * opposite ordering `create()` uses deliberately, where an orphaned user
   * is the thing to avoid instead. Locked with `issueKey()`, so concurrent
   * issuance cannot mint a key the moment after this reads the account as
   * still active.
   *
   * @throws \InvalidArgumentException
   *   When the account is not a service account or the actor does not
   *   administer its workspace.
   * @throws \Drupal\bb_api_key\ServiceAccountCleanupException
   *   When cleanup (membership removal or key revocation) fails partway;
   *   the account stays blocked and a retry is safe.
   * @throws \RuntimeException
   *   When another operation holds this account's lock; nothing changed.
   */
  public function disable(UserInterface $user, AccountInterface $actor): void {
    $this->withUserLock((int) $user->id(), function () use ($user, $actor): void {
      $user = $this->reload($user);
      $this->assertManageable($user, $actor);

      // IDEMPOTENT: a retry after a failed cleanup reaches here with the
      // account already blocked and only finishes the remaining work.
      if (!$user->isBlocked()) {
        $user->block();
        // Core's signal for a trusted internal write: the one legitimate
        // exception `ServiceAccountHooks::userPresave()` carves out of its
        // otherwise-absolute status-change guard.
        $user->setSyncing(TRUE);
        $user->save();
      }

      try {
        $memberships = $this->entityTypeManager->getStorage('og_membership');
        $memberships->delete($memberships->loadByProperties(['uid' => $user->id()]));
        foreach ($this->managedConsumers($user) as $consumer) {
          $this->apiKeyManager->revoke($consumer, $user);
        }
        $this->sessionManager->delete((int) $user->id());
      }
      catch (\Throwable $error) {
        throw new ServiceAccountCleanupException('The account is blocked, but its memberships or keys could not be fully revoked. Retry disable.', 0, $error);
      }
    });
  }

  /**
   * Every managed consumer owned by this account.
   *
   * Public: the Service Accounts listing (`ServiceAccountKeys` views field)
   * reads the same set to render each account's key metadata/actions.
   *
   * @return array<int, \Drupal\consumers\Entity\ConsumerInterface>
   *   The managed consumers; an ordinary (unmanaged) consumer owned the same
   *   way is defensively left untouched, matching `ApiKeyManager::isManaged()`.
   */
  public function managedConsumers(UserInterface $user): array {
    $storage = $this->entityTypeManager->getStorage('consumer');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('owner_id', $user->id())
      ->condition('user_id', $user->id())
      ->execute();
    $consumers = $storage->loadMultiple($ids);
    return array_values(array_filter(
      $consumers,
      fn ($consumer): bool => $consumer instanceof ConsumerInterface && $this->apiKeyManager->isManaged($consumer),
    ));
  }

  /**
   * Confirms the account is a service account the actor may administer.
   *
   * @throws \InvalidArgumentException
   *   When either check fails.
   */
  private function assertManageable(UserInterface $user, AccountInterface $actor): void {
    $workspaceId = $this->workspaceId($user);
    if ($workspaceId === NULL) {
      throw new \InvalidArgumentException('This account is not a service account.');
    }
    $workspace = $this->entityTypeManager->getStorage('bb_workspace')->load($workspaceId);
    if (!$workspace instanceof BbWorkspaceInterface || !$workspace->access('update', $actor)) {
      throw new \InvalidArgumentException("The acting account does not administer this service account's workspace.");
    }
  }

  /**
   * Reloads a user entity, so a lock-holder sees the current saved state.
   */
  private function reload(UserInterface $user): UserInterface {
    $this->entityTypeManager->getStorage('user')->resetCache([$user->id()]);
    $reloaded = $this->entityTypeManager->getStorage('user')->load($user->id());
    if (!$reloaded instanceof UserInterface) {
      throw new \InvalidArgumentException('The account no longer exists.');
    }
    return $reloaded;
  }

  /**
   * Runs `$operation` under this user's lock, releasing it in every outcome.
   *
   * @param int $uid
   *   The user id the lock is scoped to.
   * @param callable(): mixed $operation
   *   The operation to run while holding the lock.
   *
   * @return mixed
   *   Whatever `$operation` returns.
   *
   * @throws \RuntimeException
   *   When the lock cannot be acquired.
   */
  private function withUserLock(int $uid, callable $operation): mixed {
    $name = 'bb_api_key_service_account:' . $uid;
    if (!$this->lock->acquire($name, 10.0)) {
      throw new \RuntimeException('Another operation on this service account is in progress. Try again.');
    }
    try {
      return $operation();
    }
    finally {
      $this->lock->release($name);
    }
  }

  /**
   * Runs `$operation` with the session temporarily switched to `$user`.
   *
   * `ApiKeyManager::create()` validates the new consumer, which includes a
   * `ValidReferenceConstraint` check that the CURRENT session may `view`
   * both `owner_id` and `user_id` — satisfied for the self-service flow
   * because the actor and the referenced account are the same person. Here
   * the actor is the administering workspace Lead, not the service account,
   * so without this switch the reference check fails even though the
   * administrator is fully authorized; a user can always view their own
   * profile, which is exactly the account this switches to.
   *
   * @param \Drupal\user\UserInterface $user
   *   The service account to switch into.
   * @param callable(): mixed $operation
   *   The operation to run as `$user`.
   *
   * @return mixed
   *   Whatever `$operation` returns.
   */
  private function asServiceUser(UserInterface $user, callable $operation): mixed {
    $this->accountSwitcher->switchTo($user);
    try {
      return $operation();
    }
    finally {
      $this->accountSwitcher->switchBack();
    }
  }

  /**
   * Creates and saves the marked, passwordless, mail-less service user.
   *
   * Generates `service-<stem>-<8 hex chars>`, retrying ONLY a generated-name
   * collision (up to `MAX_NAME_ATTEMPTS`); an invalid or empty stem fails
   * immediately rather than being silently truncated into something that
   * happens to validate.
   *
   * @throws \InvalidArgumentException
   *   When `$name` yields no valid username stem.
   */
  private function createUser(string $name, BbWorkspaceInterface $workspace): UserInterface {
    $stem = $this->usernameStem($name);
    $storage = $this->entityTypeManager->getStorage('user');

    for ($attempt = 0; $attempt < self::MAX_NAME_ATTEMPTS; $attempt++) {
      $candidate = 'service-' . $stem . '-' . bin2hex(random_bytes(4));
      // A DIRECT EXISTENCE QUERY, not `$user->validate()`: the full
      // entity-level constraint set also runs mail-required and
      // reference-access checks that assume a human, interactively-created
      // account and a viewer session — neither of which applies to a
      // service account created by an administering actor on its behalf.
      $existing = $storage->getQuery()->accessCheck(FALSE)->condition('name', $candidate)->range(0, 1)->execute();
      if ($existing !== []) {
        continue;
      }
      $user = $storage->create([
        'name' => $candidate,
        'status' => 1,
        self::MARKER_FIELD => $workspace->id(),
      ]);
      assert($user instanceof UserInterface);
      try {
        $storage->save($user);
      }
      catch (\Throwable $error) {
        // Retry only when a concurrent create won the same candidate.
        if ($storage->getQuery()->accessCheck(FALSE)->condition('name', $candidate)->range(0, 1)->execute() === []) {
          throw $error;
        }
        continue;
      }
      return $user;
    }
    throw new \InvalidArgumentException('Could not generate a unique service-account name; try again.');
  }

  /**
   * Validates and lower-cases `$name` into a username stem.
   *
   * Limited so `service-<stem>-xxxxxxxx` fits
   * `UserInterface::USERNAME_MAX_LENGTH`; the fixed prefix/suffix take 17
   * characters (`service-` + `-` + 8 hex digits).
   *
   * @throws \InvalidArgumentException
   *   When `$name` is empty, invalid, or too long once trimmed.
   */
  private function usernameStem(string $name): string {
    $trimmed = trim($name);
    if ($trimmed === '') {
      throw new \InvalidArgumentException('A name is required.');
    }
    $stem = strtolower((string) preg_replace('/[^A-Za-z0-9._-]+/', '-', $trimmed));
    $stem = trim($stem, '-');
    if ($stem === '') {
      throw new \InvalidArgumentException('The name must contain at least one letter, digit, period, hyphen or underscore.');
    }
    $maxStemLength = UserInterface::USERNAME_MAX_LENGTH - strlen('service-') - strlen('-') - 8;
    if (strlen($stem) > $maxStemLength) {
      throw new \InvalidArgumentException("The name is too long; it must be $maxStemLength characters or fewer once normalized.");
    }
    return $stem;
  }

}
