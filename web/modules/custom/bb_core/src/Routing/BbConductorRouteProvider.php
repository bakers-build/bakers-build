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
 * The product Overview is core's `_entity_view: bb_conductor.full`, whose
 * card only shows the conductor; its Settings tab edits it. Only the title
 * callback is replaced. Do not add a controller that merely renders the view
 * mode.
 *
 * @see \Drupal\bb_core\Routing\BbTeamRouteProvider
 */
final class BbConductorRouteProvider extends AdminHtmlRouteProvider {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'entity.bb_conductor.canonical' => 'This conductor and its details.',
    'bb_core.bb_conductor.settings' => "Change this conductor's settings.",
    'entity.bb_conductor.delete_form' => 'Confirm the deletion of this conductor.',
  ];

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
   * Adds Settings, the conductor's edit form as a page.
   */
  public function getRoutes(EntityTypeInterface $entity_type) {
    $collection = parent::getRoutes($entity_type);
    $collection->add('bb_core.bb_conductor.settings', new Route(
      '/_workspace/{bb_workspace}/conductor/{bb_conductor}/settings',
      [
        '_entity_form' => 'bb_conductor.settings',
        '_title_callback' => static::class . '::title',
      ],
      ['_entity_access' => 'bb_conductor.update'],
      ['parameters' => ['bb_conductor' => ['type' => 'entity:bb_conductor']]],
    ));
    foreach (self::DESCRIPTIONS as $name => $description) {
      $collection->get($name)?->setDefault('_description', $description);
    }
    return $collection;
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
