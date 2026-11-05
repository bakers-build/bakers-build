<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\user\UserInterface;

/**
 * Grants the `edit profile` user operation on the own account.
 *
 * The operation is separate from `update`, so whoever else a module grants it
 * to never reaches mail, password or the user edit form. Core's
 * `administer users` already allows every user operation.
 */
final class UserProfileAccessHooks {

  /**
   * Implements hook_ENTITY_TYPE_access() for user.
   */
  #[Hook('user_access')]
  public function userAccess(UserInterface $user, string $operation, AccountInterface $account): AccessResultInterface {
    if ($operation !== 'edit profile') {
      return AccessResult::neutral();
    }
    return AccessResult::allowedIf($account->isAuthenticated() && (int) $account->id() === (int) $user->id())
      ->cachePerUser();
  }

}
