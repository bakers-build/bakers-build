<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Trigger pages live under their template, in the product frontend.
 *
 * Every route upcasts `{bb_ticket_template}`; adding a trigger also needs
 * template `update`, the trigger's own access covers the rest.
 */
final class BbTicketTriggerRouteProvider extends AdminHtmlRouteProvider {

  /**
   * {@inheritdoc}
   */
  public function getRoutes(EntityTypeInterface $entity_type) {
    $collection = parent::getRoutes($entity_type);
    $toggle = new Route('/_workspace/{bb_workspace}/ticket-template/{bb_ticket_template}/trigger/{bb_ticket_trigger}/toggle');
    $toggle->setDefaults(['_entity_form' => 'bb_ticket_trigger.toggle', '_title' => 'Pause or resume trigger']);
    $toggle->setRequirement('_entity_access', 'bb_ticket_trigger.toggle');
    $toggle->setOption('parameters', ['bb_ticket_trigger' => ['type' => 'entity:bb_ticket_trigger']]);
    $collection->add('entity.bb_ticket_trigger.toggle_form', $toggle);
    foreach ($collection as $route) {
      $parameters = $route->getOption('parameters') ?? [];
      $parameters['bb_ticket_template'] = ['type' => 'entity:bb_ticket_template'];
      $route->setOption('parameters', $parameters);
      $route->setOption('_admin_route', FALSE);
    }
    return $collection;
  }

  /**
   * {@inheritdoc}
   */
  protected function getAddFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getAddFormRoute($entity_type);
    $route?->setRequirement('_entity_access', 'bb_ticket_template.update');
    // These pages are the `template` target's UI; the path carries no bundle.
    $route?->setRequirement('_entity_create_access', 'bb_ticket_trigger:template');
    $route?->setDefault('_title', 'Add trigger');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE, 'bundle_parameter' => TRUE]));
    return $route;
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getEditFormRoute($entity_type);
    // Static: core's editTitle() would title the first entity parameter.
    $route?->setDefault('_title', 'Edit trigger');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE]));
    return $route;
  }

  /**
   * {@inheritdoc}
   */
  protected function getDeleteFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getDeleteFormRoute($entity_type);
    $route?->setDefault('_title', 'Delete trigger');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE]));
    return $route;
  }

}
