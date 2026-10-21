<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\user\UserInterface;

/**
 * Route access for the personal and team time calendars.
 */
final class TimeRouteAccess {

  /**
   * The personal calendar belongs to its account alone.
   */
  public static function personal(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $user = $route_match->getParameter('user');
    $own = $user instanceof UserInterface
      && $account->isAuthenticated()
      && (int) $user->id() === (int) $account->id();
    return AccessResult::allowedIf($own)->addCacheContexts(['user', 'url.path']);
  }

  /**
   * The team calendar is for the team's leads only.
   */
  public static function team(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $team = $route_match->getParameter('bb_team');
    if (!$team instanceof BbTeamInterface) {
      return AccessResult::forbidden()->addCacheContexts(['url.path']);
    }
    $leads = \Drupal::service('bb_track.worklog_scope')->leads($account, $team);
    return AccessResult::allowedIf($leads)
      ->addCacheContexts(['user'])
      ->addCacheTags(['og_membership_list'])
      ->addCacheableDependency($team);
  }

}
