<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Entity\BbConductorInterface;
use Symfony\Component\Routing\Route;

/**
 * Uses the full Display Builder view for the canonical conductor screen.
 *
 * Add, edit, delete and the collection stay admin routes. The product
 * Overview is core's `_entity_view: bb_conductor.full`; only its title
 * callback is replaced. Do not add a controller that merely renders the
 * view mode.
 *
 * @see \Drupal\bb_core\Routing\BbTeamRouteProvider
 */
final class BbConductorRouteProvider extends AdminHtmlRouteProvider {

  /**
   * Titles the conductor, "(unnamed)" when its label is blank.
   *
   * Core's `EntityController::title()` titles the FIRST entity parameter, and
   * on `/_workspace/{bb_workspace}/conductor/{bb_conductor}` that is the
   * workspace.
   */
  public static function title(BbConductorInterface $bb_conductor): string {
    $label = trim((string) $bb_conductor->label());
    return $label !== '' ? $label : (string) new TranslatableMarkup('(unnamed)');
  }

  /**
   * {@inheritdoc}
   *
   * Core's canonical route, with the view mode pinned and the TITLE callback
   * replaced. The body is unaffected: `_entity_view` resolves its subject by
   * key.
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    if ($route === NULL) {
      return NULL;
    }
    $defaults = $route->getDefaults();
    $defaults['_entity_view'] = 'bb_conductor.full';
    unset($defaults['_controller']);
    $defaults['_title_callback'] = static::class . '::title';
    unset($defaults['_title'], $defaults['_title_callback_arguments']);
    $route->setDefaults($defaults);
    return $route;
  }

}
