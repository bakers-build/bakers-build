<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Keeps canonical/add/edit/delete in the product frontend, not /admin.
 *
 * Only `collection` stays an admin-themed route: it exists solely to satisfy
 * `field_ui_base_route` and is never linked from product navigation. The
 * product entry point is the project's "Templates" tab
 * (Views page `view.bb_ticket_templates.project_list`).
 *
 * @see \Drupal\bb_core\Routing\BbTicketRouteProvider
 */
final class BbTicketTemplateRouteProvider extends AdminHtmlRouteProvider {

  /**
   * {@inheritdoc}
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    return $this->asFrontendRoute(parent::getCanonicalRoute($entity_type));
  }

  /**
   * {@inheritdoc}
   */
  protected function getAddFormRoute(EntityTypeInterface $entity_type): ?Route {
    return $this->asFrontendRoute(parent::getAddFormRoute($entity_type));
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = $this->asFrontendRoute(parent::getEditFormRoute($entity_type));
    // The template's Settings tab. A static title: core's `editTitle()` would
    // title the route's first entity parameter, the workspace.
    $route?->setDefault('_title', 'Settings');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE]));
    return $route;
  }

  /**
   * {@inheritdoc}
   */
  protected function getDeleteFormRoute(EntityTypeInterface $entity_type): ?Route {
    return $this->asFrontendRoute(parent::getDeleteFormRoute($entity_type));
  }

  /**
   * Drops the admin theme/toolbar for one route, leaving all else untouched.
   */
  private function asFrontendRoute(?Route $route): ?Route {
    $route?->setOption('_admin_route', FALSE);
    return $route;
  }

}
