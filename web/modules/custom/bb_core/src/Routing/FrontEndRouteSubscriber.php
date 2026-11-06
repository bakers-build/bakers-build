<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Drupal\Core\Routing\RoutingEvents;
use Symfony\Component\Routing\RouteCollection;

/**
 * Makes every route a front-end route, rendered in the island shell.
 *
 * Island skips admin routes, and only the shell has the overlay a dialog
 * opens in. FALSE rather than unset, so nothing reads "no opinion" later.
 */
final class FrontEndRouteSubscriber extends RouteSubscriberBase {

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach ($collection as $route) {
      $route->setOption('_admin_route', FALSE);
    }
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, array{string, int}>
   *   The alter event, after core's AdminRouteSubscriber (-200).
   */
  public static function getSubscribedEvents(): array {
    return [RoutingEvents::ALTER => ['onAlterRoutes', -1024]];
  }

}
