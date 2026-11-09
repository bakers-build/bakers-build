<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Titles the term edit form under the workspace.
 */
final class BbTermRouteProvider extends AdminHtmlRouteProvider {

  /**
   * {@inheritdoc}
   */
  protected function getEditFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getEditFormRoute($entity_type);
    // A static title: core's `editTitle()` would title the route's first
    // entity parameter, the workspace.
    $route?->setDefault('_title', 'Edit');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE]));
    return $route;
  }

}
