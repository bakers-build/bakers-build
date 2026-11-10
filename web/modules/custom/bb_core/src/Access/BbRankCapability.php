<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\og\MembershipManagerInterface;
use Drupal\og\OgAccessInterface;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Oauth2ScopeProviderInterface;
use Drupal\simple_oauth\Plugin\Field\FieldType\Oauth2ScopeReferenceItemListInterface;
use Psr\Log\LoggerInterface;
use Drupal\user\RoleInterface;

/**
 * Resolves what an account's OG ranks grant it.
 *
 * One membership query per account per request: MembershipManager runs a
 * single og_membership entity query and memoises the ids in cache.static, and
 * the permission union is memoised here on top of it, so the whole of Layer A
 * costs what the read scope already paid.
 *
 * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
 */
final class BbRankCapability implements BbRankCapabilityInterface {

  /**
   * The resolved permission union, keyed by uid.
   *
   * @var array<int, array<string>>
   */
  private array $permissions = [];

  public function __construct(
    private readonly ?MembershipManagerInterface $membershipManager,
    private readonly ?OgAccessInterface $ogAccess,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly LoggerInterface $logger,
    private readonly MembershipResolutionGuard $guard,
    // Optional like $ogAccess: simple_oauth is not a bb_core dependency, so
    // the service reference must survive its absence. $superUserEnabled has
    // no default: constructing without the container parameter must not
    // silently enable Drupal's uid-1 bypass.
    private readonly ?Oauth2ScopeProviderInterface $scopeProvider,
    private readonly bool $superUserEnabled,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function rankPermissions(AccountInterface $account): array {
    $uid = (int) $account->id();
    if (isset($this->permissions[$uid])) {
      return $this->permissions[$uid];
    }
    $permissions = [];
    // No OG, no ranks: fail closed (see bb_core.services.yml).
    if ($this->membershipManager === NULL) {
      return $this->permissions[$uid] = [];
    }
    try {
      // Guarded: this runs inside AccessPolicyProcessor, which has no
      // recursion guard; see MembershipResolutionGuard.
      $memberships = $this->guard->resolving(
        fn (): array => $this->membershipManager->getMemberships($uid),
      );
    }
    catch (\Exception $e) {
      // Permission checks must never fatal (exception page, installer, a site
      // before og_membership's schema exists). Fail closed, and log, because
      // "rankless" is otherwise indistinguishable from a missing schema.
      $this->logger->warning(
        'Rank permissions unresolved for uid @uid, treated as rankless: @message',
        ['@uid' => $uid, '@message' => $e->getMessage()],
      );

      return $this->permissions[$uid] = [];
    }

    foreach ($memberships as $membership) {
      foreach ($membership->getRoles() as $role) {
        // An is_admin rank is deliberately NOT expanded, and cannot be:
        // OgRole::getPermissions() returns [] for one, and OgAccess
        // short-circuits on it, so the set it stands for is not enumerable
        // bakers.build ships none; a contributed one
        // grants nothing here rather than everything.
        $permissions = array_merge($permissions, $role->getPermissions());
      }
    }
    $permissions = array_values(array_unique($permissions));
    sort($permissions);

    return $this->permissions[$uid] = $permissions;
  }

  /**
   * {@inheritdoc}
   */
  public function hasSiteWidePermission(AccountInterface $account, string $permission): bool {
    $machine_answer = $this->machineScopeAnswer($account, $permission);
    if ($machine_answer !== NULL) {
      return $machine_answer;
    }

    $roles = $this->entityTypeManager->getStorage('user_role')
      ->loadMultiple($account->getRoles());
    foreach ($roles as $role) {
      if (!$role instanceof RoleInterface) {
        continue;
      }
      if ($role->isAdmin() || $role->hasPermission($permission)) {
        return TRUE;
      }
    }

    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function isInstanceAdmin(AccountInterface $account): bool {
    // JSON:API field access and injected current_user pass AccountProxy,
    // which wraps TokenAuthUser and does not implement
    // TokenAuthUserInterface. Unwrap before the token check.
    if ($account instanceof AccountProxyInterface) {
      $account = $account->getAccount();
    }
    // Cookie uid 1 follows Drupal's super-user setting. A user-bound token
    // must not: SuperUserAccessPolicy marks uid 1 isAdmin and
    // Oauth2AccessPolicy keeps that flag, so hasPermission('administer bakers')
    // is TRUE for a uid-1 bb:session token. hasSiteWidePermission() reads
    // TokenAuthUser::getRoles() instead — the intersection with the token,
    // which for permission-granularity scopes is only authenticated.
    if (
      !$account instanceof TokenAuthUserInterface
      && $this->superUserEnabled
      && (int) $account->id() === 1
    ) {
      return TRUE;
    }
    return $this->hasSiteWidePermission($account, 'administer bakers');
  }

  /**
   * Answers a pure machine identity's permission from its OAuth scope.
   *
   * A client_credentials identity holds no role; Oauth2AccessPolicy replaces
   * its permission set with the token's scopes. BbGroupScopedAccount reads
   * only roles and OG ranks, so without this branch every conductor write
   * would fail the fence (MachineIdentityWriteSufficiencyTest). Read off the
   * token's scopes, not the calculated set, which carries the rank union.
   *
   * Do not unwrap AccountProxy here. JSON:API passes current_user wrapping a
   * client_credentials TokenAuthUser whose auth_user_id is empty and whose
   * subject is the consumer user. Unwrapping would treat that as a pure
   * machine identity and grant the session children (update any bb_group)
   * site-wide. Those tokens have a user with ranks; the rank fence decides.
   * isInstanceAdmin() still unwraps so the uid-1 token check sees
   * TokenAuthUserInterface.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account being asked about.
   * @param string $permission
   *   The permission to check.
   *
   * @return bool|null
   *   TRUE or FALSE when the account is a pure machine identity this method
   *   can answer for; NULL when it is not, so the caller falls through to
   *   the ordinary role check.
   */
  private function machineScopeAnswer(AccountInterface $account, string $permission): ?bool {
    if ($this->scopeProvider === NULL || !$account instanceof TokenAuthUserInterface) {
      return NULL;
    }
    if (!$account->getToken()->get('auth_user_id')->isEmpty()) {
      return NULL;
    }
    $scopes_field = $account->getToken()->get('scopes');
    if (!$scopes_field instanceof Oauth2ScopeReferenceItemListInterface) {
      return NULL;
    }

    foreach ($scopes_field->getScopes() as $scope) {
      if ($this->scopeProvider->scopeHasPermission($permission, $scope)) {
        return TRUE;
      }
    }

    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function hasGroupPermission(AccountInterface $account, string $permission, EntityInterface $group): bool {
    // $skip_alter = TRUE: bb_core_og_user_access_alter() maps site-wide
    // permissions onto OG's answer, so consulting it here would let the fence
    // be widened by the mapping it exists to bound.
    //
    // Guarded for the same reason as rankPermissions(): OgAccess resolves the
    // account's membership in the group with `accessCheck(TRUE)`, and this is
    // asked about ANOTHER account often enough — BbGroupScopedAccount is
    // exactly that — that filtering it by the CURRENT user's read scope would
    // answer "no rank" for a rank that exists.
    // NO OG, NO GROUP PERMISSION — the fence denies rather than opens when the
    // module that owns group access is not enabled (`bb_core.services.yml`).
    if ($this->ogAccess === NULL) {
      return FALSE;
    }
    return $this->guard->resolving(
      fn (): bool => $this->ogAccess
        ->userAccess($group, $permission, $account, TRUE)
        ->isAllowed(),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function hasGroupRolePermission(AccountInterface $account, string $permission, EntityInterface $group): bool {
    // NO OG, NO MEMBERSHIP — same fail-closed answer as the two methods above.
    if ($this->membershipManager === NULL) {
      return FALSE;
    }
    // Guarded for the same re-entrancy reason as rankPermissions() and
    // hasGroupPermission(): resolving a membership can reach the read-scope
    // listener, which would otherwise recurse into permission calculation
    // with nothing memoised.
    $membership = $this->guard->resolving(
      fn () => $this->membershipManager->getMembership($group, (int) $account->id()),
    );

    return $membership !== NULL && $membership->hasPermission($permission);
  }

}
