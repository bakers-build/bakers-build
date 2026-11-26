<?php

declare(strict_types=1);

namespace Drupal\bb_track\Menu;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Menu\LocalActionDefault;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Menu\CreateActionAccessInterface;
use Drupal\bb_track\Access\WorklogFormAccess;

/**
 * The Record time plus on the time calendars.
 *
 * Narrower than its route: `/time/add` records in any workspace, while a
 * workspace calendar offers the plus only to who may record in THAT one.
 */
final class WorklogCreateAction extends LocalActionDefault implements CreateActionAccessInterface {

  /**
   * {@inheritdoc}
   */
  public function createAccess(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    if ($route_match->getRouteName() === 'view.worklog.personal') {
      return WorklogFormAccess::add($account);
    }
    $workspace = $route_match->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $allowed = WorklogFormAccess::canRecord($account, $workspace);
    return ($allowed ? AccessResult::allowed() : AccessResult::forbidden())
      ->addCacheContexts(['route', 'user', 'user.permissions'])
      ->addCacheTags(['og_membership_list']);
  }

}
