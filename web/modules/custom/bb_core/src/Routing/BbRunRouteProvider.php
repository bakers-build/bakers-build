<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Entity\BbRunInterface;
use Symfony\Component\Routing\Route;

/**
 * Ticket-relative canonical and overlay views for a run.
 *
 * Edit and delete stay on the un-nested workspace paths. Add and the
 * collection stay admin routes.
 */
final class BbRunRouteProvider extends AdminHtmlRouteProvider {

  /**
   * Titles the run as "Run #id".
   */
  public static function title(BbRunInterface $bb_run): string {
    return (string) new TranslatableMarkup('Run #@id', ['@id' => $bb_run->id()]);
  }

  /**
   * {@inheritdoc}
   */
  public function getRoutes(EntityTypeInterface $entity_type) {
    $collection = parent::getRoutes($entity_type);
    $overlay = $this->overlayRoute($entity_type);
    if ($overlay !== NULL) {
      $collection->add('entity.bb_run.overlay', $overlay);
    }
    return $collection;
  }

  /**
   * {@inheritdoc}
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    return $route === NULL ? NULL : $this->pinProductView($route, 'bb_run.full');
  }

  /**
   * The overlay body, so island_dialog does not wrap the canonical page.
   */
  private function overlayRoute(EntityTypeInterface $entity_type): ?Route {
    if (!$entity_type->hasLinkTemplate('overlay')) {
      return NULL;
    }
    $route = new Route($entity_type->getLinkTemplate('overlay'));
    $route->setDefault('_entity_view', 'bb_run.overlay');
    $route->setRequirement('_entity_access', 'bb_run.view');
    $route->setOption('parameters', [
      'bb_run' => ['type' => 'entity:bb_run'],
    ]);
    return $this->pinProductView($route, 'bb_run.overlay');
  }

  /**
   * Pins the view mode, title, ticket upcast and parentage check.
   */
  private function pinProductView(Route $route, string $view): Route {
    $defaults = $route->getDefaults();
    $defaults['_entity_view'] = $view;
    unset($defaults['_controller'], $defaults['_title'], $defaults['_title_callback_arguments']);
    $defaults['_title_callback'] = static::class . '::title';
    $route->setDefaults($defaults);
    $parameters = $route->getOption('parameters') ?? [];
    $parameters['bb_run'] = $parameters['bb_run'] ?? ['type' => 'entity:bb_run'];
    $parameters['bb_ticket'] = ['type' => 'entity:bb_ticket'];
    $route->setOption('parameters', $parameters);
    $route->setRequirement('_bb_run_parentage_match', 'TRUE');
    return $route;
  }

}
