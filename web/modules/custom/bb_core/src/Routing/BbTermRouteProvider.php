<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Titles the term's edit form under the workspace.
 *
 * Core's `EntityController` title would title the route's first entity
 * parameter, the workspace.
 */
final class BbTermRouteProvider extends AdminHtmlRouteProvider {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'entity.bb_term.add_form' => 'Add a type, recipe or label to the catalog of this workspace.',
    'entity.bb_term.edit_form' => 'Change this catalog entry.',
    'entity.bb_term.delete_form' => 'Confirm the deletion of this catalog entry.',
  ];

  /**
   * {@inheritdoc}
   */
  public function getRoutes(EntityTypeInterface $entity_type) {
    $collection = parent::getRoutes($entity_type);
    foreach (self::DESCRIPTIONS as $name => $description) {
      $collection->get($name)?->setDefault('_description', $description);
    }
    return $collection;
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getEditFormRoute($entity_type);
    $route?->setDefault('_title', 'Edit');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE]));
    return $route;
  }

}
