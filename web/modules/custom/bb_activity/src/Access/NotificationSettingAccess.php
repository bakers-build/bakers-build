<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\user\UserInterface;

/**
 * The one rule for the settings page and the row: own account or admin.
 */
final class NotificationSettingAccess {

  /**
   * Whether the account may read and change the owner's settings.
   */
  public static function check(int $owner_uid, AccountInterface $account): AccessResultInterface {
    $own = $account->isAuthenticated() && $owner_uid > 0 && (int) $account->id() === $owner_uid;
    return AccessResult::allowedIfHasPermission($account, 'administer bakers')
      ->orIf(AccessResult::allowedIf($own)->cachePerUser());
  }

  /**
   * Route access for /user/{user}/notifications.
   */
  public static function route(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $user = $route_match->getParameter('user');
    $owner_uid = $user instanceof UserInterface ? (int) $user->id() : 0;
    return AccessResult::allowed()
      ->addCacheContexts(['url.path'])
      ->andIf(self::check($owner_uid, $account));
  }

}
