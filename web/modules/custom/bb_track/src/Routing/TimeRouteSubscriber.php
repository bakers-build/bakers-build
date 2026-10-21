<?php

declare(strict_types=1);

namespace Drupal\bb_track\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Drupal\bb_track\Access\TimeRouteAccess;
use Symfony\Component\Routing\RouteCollection;

/**
 * Adds owner and team-lead access to the time calendar routes.
 *
 * Views owns the routes; their visibility policy lives here so a tab or a
 * direct request is refused before any query runs.
 */
final class TimeRouteSubscriber extends RouteSubscriberBase {

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    $personal = $collection->get('view.worklog.personal');
    if ($personal !== NULL) {
      $parameters = $personal->getOption('parameters') ?? [];
      $parameters['user'] = ['type' => 'entity:user'];
      $personal->setOption('parameters', $parameters);
      $personal->setRequirement('_custom_access', TimeRouteAccess::class . '::personal');
      $personal->setRequirement('user', '\d+');
    }
    $team = $collection->get('view.worklog.team');
    if ($team !== NULL) {
      $team->setRequirement('_custom_access', TimeRouteAccess::class . '::team');
    }
  }

}
