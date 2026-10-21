<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Replaces HTML error presentation while preserving core exception handling.
 */
final class BbErrorPageRouteSubscriber extends RouteSubscriberBase {

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach ([403 => 'Access denied', 404 => 'Page not found'] as $status => $title) {
      $route = $collection->get('system.' . $status);
      if ($route !== NULL) {
        $route->setDefault('_controller', '\\Drupal\\bb_core\\Controller\\BbErrorPageController::on' . $status);
        $route->setDefault('_title', $status . ' — ' . $title);
      }
    }
  }

}
