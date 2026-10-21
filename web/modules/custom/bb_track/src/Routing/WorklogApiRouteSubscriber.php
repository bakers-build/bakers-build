<?php

declare(strict_types=1);

namespace Drupal\bb_track\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Keeps JSON:API Worklog routes to collection and item GET/HEAD.
 */
final class WorklogApiRouteSubscriber extends RouteSubscriberBase {

  /**
   * JSON:API route-name prefix for this resource type.
   */
  private const PREFIX = 'jsonapi.bb_track_worklog--bb_track_worklog.';

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach ($collection->all() as $name => $route) {
      if (!str_starts_with($name, self::PREFIX)) {
        continue;
      }
      $methods = $route->getMethods();
      if ($methods !== [] && array_intersect($methods, ['POST', 'PATCH', 'DELETE']) === []) {
        continue;
      }
      $collection->remove($name);
    }
  }

}
