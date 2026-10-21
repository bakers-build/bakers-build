<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Controller\BbTicketDetailController;
use Symfony\Component\Routing\Route;

/**
 * Uses the full Display Builder view for the canonical ticket screen.
 *
 * Edit (the `settings` operation) and delete render in the app shell; add
 * and the collection stay admin routes.
 *
 * @see \Drupal\bb_core\Routing\BbTeamRouteProvider
 */
final class BbTicketRouteProvider extends AdminHtmlRouteProvider {

  /**
   * {@inheritdoc}
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    if ($route === NULL) {
      return NULL;
    }
    $defaults = $route->getDefaults();
    $defaults['_entity_view'] = 'bb_ticket.full';
    unset($defaults['_controller']);
    $defaults['_title_callback'] = BbTicketDetailController::class . '::title';
    unset($defaults['_title'], $defaults['_title_callback_arguments']);
    $route->setDefaults($defaults);
    return $route;
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getEditFormRoute($entity_type);
    if ($route !== NULL) {
      $route->setDefault('_entity_form', 'bb_ticket.settings');
      // The shell's page header keeps the ticket headline on its Settings.
      $route->setDefault('_title_callback', BbTicketDetailController::class . '::title');
      $route->setOption('_admin_route', FALSE);
    }
    return $route;
  }

  /**
   * {@inheritdoc}
   */
  protected function getDeleteFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getDeleteFormRoute($entity_type);
    $route?->setOption('_admin_route', FALSE);
    return $route;
  }

}
