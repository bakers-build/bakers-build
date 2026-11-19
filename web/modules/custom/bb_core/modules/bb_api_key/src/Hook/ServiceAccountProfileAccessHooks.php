<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_api_key\Access\ServiceAccountAccess;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\user\UserInterface;

/**
 * Lets a workspace lead edit the profile of its active service accounts.
 *
 * The profile only in the service account's own workspace.
 */
final class ServiceAccountProfileAccessHooks {

  public function __construct(
    private readonly ServiceAccountManager $serviceAccountManager,
    private readonly ServiceAccountAccess $serviceAccountAccess,
  ) {}

  /**
   * Implements hook_ENTITY_TYPE_access() for user.
   *
   * Grants only `edit profile`; neutral for humans, disabled accounts and
   * every other operation.
   */
  #[Hook('user_access')]
  public function userAccess(UserInterface $user, string $operation, AccountInterface $account): AccessResultInterface {
    if ($operation !== 'edit profile') {
      return AccessResult::neutral();
    }
    $workspace = $this->serviceAccountManager->workspace($user);
    if ($workspace === NULL || !$user->isActive()) {
      return AccessResult::neutral()->addCacheableDependency($user);
    }
    $allowed = $this->serviceAccountAccess->manage($workspace, $account, $user);
    return $allowed->isAllowed() ? $allowed : AccessResult::neutral()->addCacheableDependency($allowed);
  }

  /**
   * Implements hook_ENTITY_TYPE_access() for bb_profile.
   *
   * Extends the `edit profile` grant to the service account's profile in its
   * own workspace, for view and update only.
   */
  #[Hook('bb_profile_access')]
  public function profileAccess(BbProfileInterface $profile, string $operation, AccountInterface $account): AccessResultInterface {
    $owner = $profile->getOwner();
    if (!in_array($operation, ['view', 'update'], TRUE) || !$owner instanceof UserInterface) {
      return AccessResult::neutral();
    }
    $workspace = $this->serviceAccountManager->workspace($owner);
    if ($workspace === NULL || (int) $workspace->id() !== $profile->workspaceId()) {
      return AccessResult::neutral()->addCacheableDependency($profile);
    }
    $allowed = $this->userAccess($owner, 'edit profile', $account);
    return AccessResult::allowedIf($allowed->isAllowed())->addCacheableDependency($allowed)->addCacheableDependency($profile);
  }

}
