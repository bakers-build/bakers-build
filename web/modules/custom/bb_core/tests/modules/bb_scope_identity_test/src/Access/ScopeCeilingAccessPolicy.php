<?php

declare(strict_types=1);

namespace Drupal\bb_scope_identity_test\Access;

use Drupal\Core\Session\AccessPolicyBase;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\CalculatedPermissionsItem;
use Drupal\Core\Session\RefinableCalculatedPermissionsInterface;
use Drupal\Core\State\StateInterface;

/**
 * Reproduces how an OAuth2 scope carries a machine identity's permissions.
 *
 * A faithful stand-in for `simple_oauth`'s `Oauth2AccessPolicy`, faithful in
 * the ONE respect the fence can tell apart: the permissions arrive through the
 * calculated-permission set and NOT through any `user_role` the account holds.
 * That distinction is the whole point of this helper.
 * `BbRankCapability::hasSiteWidePermission()` answers by loading the
 * `user_role` entities of `$account->getRoles()`, so a test that handed the
 * ceiling to the account as a ROLE would sail through
 * `BbGroupScopedAccount::hasPermission()`'s first branch and prove nothing
 * about Layer B — it would be exactly the tautology BB-391's review rejected.
 *
 * `overwrite: TRUE` and the wholesale replacement of each item's permissions
 * mirror `Oauth2AccessPolicy::alterPermissions()` for the `auth_user_id`-empty
 * case, which is every `client_credentials` token and therefore every
 * bakers.build machine identity: the set becomes EXACTLY the scope's
 * permissions, and no role and no rank survives it.
 *
 * State-driven rather than constructor-configured, because a kernel test
 * installs the module before it knows which account it is about to create.
 * Absent state means this policy does nothing at all, so merely enabling the
 * module changes no other test.
 *
 * @see \Drupal\simple_oauth\Access\Oauth2AccessPolicy
 * @see \Drupal\bb_core\Access\BbGroupScopedAccount
 */
final class ScopeCeilingAccessPolicy extends AccessPolicyBase {

  /**
   * State key holding the uid the simulated token authenticates as.
   */
  public const STATE_UID = 'bb_scope_identity_test.uid';

  /**
   * State key holding the permission list the simulated scope grants.
   */
  public const STATE_PERMISSIONS = 'bb_scope_identity_test.permissions';

  public function __construct(private readonly StateInterface $state) {}

  /**
   * {@inheritdoc}
   */
  public function applies(string $scope): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function alterPermissions(AccountInterface $account, string $scope, RefinableCalculatedPermissionsInterface $calculated_permissions): void {
    $uid = $this->state->get(self::STATE_UID);
    if ($uid === NULL || (int) $uid !== (int) $account->id()) {
      return;
    }
    /** @var array<string> $granted */
    $granted = $this->state->get(self::STATE_PERMISSIONS, []);

    foreach ($calculated_permissions->getItems() as $item) {
      $calculated_permissions->addItem(
        item: new CalculatedPermissionsItem(
          permissions: $granted,
          // Never admin: a scope confers no admin flag, and TRUE here would
          // empty the item's own permission list on top of it.
          isAdmin: FALSE,
          scope: $item->getScope(),
          identifier: $item->getIdentifier(),
        ),
        overwrite: TRUE,
      );
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getPersistentCacheContexts(): array {
    return ['user'];
  }

}
