<?php

declare(strict_types=1);

namespace Drupal\bb_track\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Drupal\bb_track\Access\TimeRouteAccess;
use Symfony\Component\Routing\RouteCollection;

/**
 * Adds owner and team-lead access to the time calendar routes.
 *
 * Also sets their `_description`, the line under the page title.
 *
 * Views owns the routes; their visibility policy lives here so a tab or a
 * direct request is refused before any query runs.
 */
final class TimeRouteSubscriber extends RouteSubscriberBase {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'view.worklog.page' => 'Your recorded hours in this workspace.',
    'view.worklog.personal' => 'Your recorded hours.',
    'view.worklog.project' => 'The hours recorded on this project.',
    'view.worklog.team' => 'The hours recorded in this team.',
  ];

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach (self::DESCRIPTIONS as $name => $description) {
      $collection->get($name)?->setDefault('_description', $description);
    }
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
