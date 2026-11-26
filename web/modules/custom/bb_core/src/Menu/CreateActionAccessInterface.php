<?php

declare(strict_types=1);

namespace Drupal\bb_core\Menu;

use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * A dialog local action whose plus is narrower than its route's access.
 *
 * `bb_create_action` ANDs this with the dialog route's own access check.
 */
interface CreateActionAccessInterface {

  /**
   * Whether the screen may offer this action's plus to the account.
   *
   * @param \Drupal\Core\Routing\RouteMatchInterface $route_match
   *   The screen's route match.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The result, with its cacheability; only "allowed" offers the plus, so
   *   neutral (e.g. `forbiddenIf(FALSE)`) hides it.
   */
  public function createAccess(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface;

}
