<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_api_key\Access\ServiceAccountAccess;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\user\UserInterface;

/**
 * Lets a workspace lead edit the profile of its active service accounts.
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

}
