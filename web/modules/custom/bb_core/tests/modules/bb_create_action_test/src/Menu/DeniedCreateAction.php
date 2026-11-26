<?php

declare(strict_types=1);

namespace Drupal\bb_create_action_test\Menu;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Menu\LocalActionDefault;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Menu\CreateActionAccessInterface;

/**
 * A create action whose own access always refuses.
 */
final class DeniedCreateAction extends LocalActionDefault implements CreateActionAccessInterface {

  /**
   * {@inheritdoc}
   */
  public function createAccess(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    return AccessResult::forbidden();
  }

}
