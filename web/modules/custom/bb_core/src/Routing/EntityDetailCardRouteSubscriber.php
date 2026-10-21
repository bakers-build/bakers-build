<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Drupal\bb_core\Controller\RetiredEditSurfaceController;
use Drupal\bb_core\Form\BbEntityDetailCardForm;
use Symfony\Component\Routing\RouteCollection;

/**
 * One POST route per editable detail card, derived from the canonical route.
 *
 * Deriving keeps the canonical route's parameters, workspace and owner
 * requirements; only the form operation and the update gate are added. The
 * product Settings routes the cards replace now lead to the detail page.
 */
final class EntityDetailCardRouteSubscriber extends RouteSubscriberBase {

  /**
   * Former product Settings routes, keyed by route name, valued by entity type.
   */
  private const RETIRED = [
    'bb_core.bb_team.settings' => 'bb_team',
    'bb_core.bb_machine.settings' => 'bb_machine',
  ];

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach (BbEntityDetailCardForm::entityTypes() as $type) {
      $canonical = $collection->get('entity.' . $type . '.canonical');
      if ($canonical === NULL) {
        continue;
      }
      foreach (BbEntityDetailCardForm::operations($type) as $operation) {
        if (BbEntityDetailCardForm::fields($type, $operation)['edit'] === []) {
          continue;
        }
        $route = clone $canonical;
        $route->setPath($canonical->getPath() . '/card/' . $operation);
        $defaults = $route->getDefaults();
        unset($defaults['_entity_view'], $defaults['_controller']);
        $defaults['_entity_form'] = $type . '.' . $operation;
        $route->setDefaults($defaults);
        $route->setRequirement('_entity_access', $type . '.update');
        $route->setRequirement('_user_is_logged_in', 'TRUE');
        $collection->add('entity.' . $type . '.' . $operation . '_form', $route);
      }
    }
    foreach (self::RETIRED as $name => $type) {
      $route = $collection->get($name);
      if ($route === NULL) {
        continue;
      }
      $route->setDefaults([
        '_controller' => RetiredEditSurfaceController::class . '::redirect',
        'entity_type_id' => $type,
      ]);
      $route->setRequirement('_entity_access', $type . '.view');
      $route->setMethods([]);
    }
  }

}
