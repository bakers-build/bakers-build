<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Session\AccessPolicyBase;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\CalculatedPermissionsItem;
use Drupal\Core\Session\RefinableCalculatedPermissionsInterface;

/**
 * Projects an account's OG rank permissions into its permission set (Layer A).
 *
 * `User::hasPermission()` routes through AccessPolicyProcessor, so a rank's
 * capability reaches every permission consumer (query access, routes,
 * JSON:API) unchanged; OG ships no access policy of its own. The union is
 * tenant-blind; Layer B fences it.
 *.
 */
final class BbRankAccessPolicy extends AccessPolicyBase {

  public function __construct(
    private readonly BbRankCapabilityInterface $rankCapability,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function calculatePermissions(AccountInterface $account, string $scope): RefinableCalculatedPermissionsInterface {
    $calculated = parent::calculatePermissions($account, $scope);
    $permissions = $this->rankCapability->rankPermissions($account);
    if ($permissions !== []) {
      // is_admin FALSE, always: a rank never confers admin, and a
      // TRUE here would empty the item's own permission list on top of it.
      $calculated->addItem(new CalculatedPermissionsItem($permissions, FALSE));
    }

    // The result changes when any membership changes, and a membership is a
    // content entity, so its list tag is the invalidation signal. Added
    // unconditionally: an account that holds nothing today must not keep an
    // empty result after being granted a rank.
    return $calculated->addCacheTags(['og_membership_list']);
  }

  /**
   * {@inheritdoc}
   */
  public function getPersistentCacheContexts(): array {
    // Memberships vary per account and cannot be expressed as a role set, so
    // the context is the account itself — one accepted extra render-cache
    // variation. NOT `user.permissions`, which is
    // computed FROM this policy and would recurse.
    return ['user'];
  }

}
