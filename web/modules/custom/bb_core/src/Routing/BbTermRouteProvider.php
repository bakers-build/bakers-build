<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Titles the term's page and edit form under the workspace.
 *
 * Core's `EntityController` titles would title the route's first entity
 * parameter, the workspace.
 */
final class BbTermRouteProvider extends AdminHtmlRouteProvider {

  /**
   * Titles the term's page with its name.
   */
  public static function title(BbTermInterface $bb_term): string {
    return (string) $bb_term->label();
  }

  /**
   * {@inheritdoc}
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    $route?->setDefault('_title_callback', static::class . '::title');
    return $route;
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
