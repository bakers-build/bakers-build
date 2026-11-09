<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Titles the template's Settings tab.
 *
 * The product entry point is the project's "Templates" tab
 * (Views page `view.bb_ticket_templates.project_list`).
 */
final class BbTicketTemplateRouteProvider extends AdminHtmlRouteProvider {

  /**
   * {@inheritdoc}
   */
  protected function getEditFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getEditFormRoute($entity_type);
    // The template's Settings tab. A static title: core's `editTitle()` would
    // title the route's first entity parameter, the workspace.
    $route?->setDefault('_title', 'Settings');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE]));
    return $route;
  }

}
