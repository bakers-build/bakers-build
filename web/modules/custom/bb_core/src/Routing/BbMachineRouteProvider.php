<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Entity\BbMachineInterface;
use Symfony\Component\Routing\Route;

/**
 * Uses the full Display Builder view for the canonical machine screen.
 *
 * Add, edit, delete and the collection stay admin routes. The product
 * Overview is core's `_entity_view: bb_machine.full`, whose cards edit the
 * machine. Only the title callback is replaced. Do not add a controller that
 * merely renders the view mode.
 *
 * @see \Drupal\bb_core\Routing\BbConductorRouteProvider
 */
final class BbMachineRouteProvider extends AdminHtmlRouteProvider {

  /**
   * Titles the machine, falling back to its UUID when the name is blank.
   *
   * Core's `EntityController::title()` titles the FIRST entity parameter, and
   * on `/user/{user}/machine/{bb_machine}` that is the account.
   */
  public static function title(BbMachineInterface $bb_machine): string {
    $label = trim((string) $bb_machine->label());
    return $label !== '' ? $label : (string) $bb_machine->uuid();
  }

  /**
   * {@inheritdoc}
   *
   * Adds the former product Settings url, which the card route subscriber
   * retires to a redirect onto the Overview.
   */
  public function getRoutes(EntityTypeInterface $entity_type) {
    $collection = parent::getRoutes($entity_type);
    $settings = new Route('/user/{user}/machine/{bb_machine}/edit');
    $settings->setOption('parameters', ['bb_machine' => ['type' => 'entity:bb_machine']]);
    $this->pinUserArea($settings);
    $collection->add('bb_core.bb_machine.settings', $settings);
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
    $defaults['_entity_view'] = 'bb_machine.full';
    unset($defaults['_controller']);
    $route->setDefaults($defaults);
    $this->pinUserArea($route);
    return $route;
  }

  /**
   * Titles the machine, upcasts `{user}`, and keeps the route in the shell.
   *
   * `{user}` must be the owner: a foreign account in the path is 404 once
   * `_entity_access` has passed; otherwise that check's 403 wins.
   */
  private function pinUserArea(Route $route): void {
    $defaults = $route->getDefaults();
    $defaults['_title_callback'] = static::class . '::title';
    unset($defaults['_title'], $defaults['_title_callback_arguments']);
    $route->setDefaults($defaults);
    $parameters = $route->getOption('parameters') ?? [];
    $parameters['user'] = ['type' => 'entity:user'];
    $route->setOption('parameters', $parameters);
    $route->setOption('_admin_route', FALSE);
    $route->setRequirement('user', '\d+');
    $route->setRequirement('_bb_machine_owner_match', 'TRUE');
  }

}
