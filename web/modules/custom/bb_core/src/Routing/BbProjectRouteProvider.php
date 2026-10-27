<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\bb_core\Controller\BbStatsController;
use Drupal\bb_core\Controller\BbProjectTabController;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/**
 * Points the project's canonical route at Overview and adds its other tabs.
 *
 * Emits the controller-backed tabs, one declaration site per screen as in
 * `BbTeamRouteProvider`; Board, Tickets, Runs, Conductors and Templates are
 * Views pages. Overview is core's `_entity_view: bb_project.full`. Only the
 * title callback is replaced. Epics live in the Overview inspector.
 */
final class BbProjectRouteProvider extends AdminHtmlRouteProvider {

  /**
   * The controller-backed tabs beyond Overview.
   *
   * `settings` is NOT one of them — see `getSettingsRoute()`. Board is a
   * Views page (`view.project_board.project_board`), not a controller.
   *
   * @var array<string>
   */
  private const TAB_ROUTES = ['stats'];

  /**
   * {@inheritdoc}
   */
  public function getRoutes(EntityTypeInterface $entity_type): RouteCollection {
    $collection = parent::getRoutes($entity_type);
    foreach (self::TAB_ROUTES as $tab) {
      $collection->add('bb_core.bb_project.' . $tab, $this->getTabRoute($tab));
    }
    $collection->add('bb_core.bb_project.settings', $this->getSettingsRoute());
    return $collection;
  }

  /**
   * One route-specific tab's route.
   *
   * Reading tabs gate on `bb_project.view`; only Settings takes `update`.
   * Stats included: statistics are permissioned per figure, so the tab
   * follows the entity and the figures filter themselves (a guest may see an
   * empty Stats tab).
   *
   * @param string $tab
   *   The tab's machine name, which is also the controller method's name.
   */
  private function getTabRoute(string $tab): Route {
    return new Route(
      '/_workspace/{bb_workspace}/project/{bb_project}/' . $tab,
      [
        // Stats is the ONE tab served by the stats controller: the Insights
        // page for this project. Every other tab keeps its own method on this
        // entity's tab controller.
        '_controller' => $tab === 'stats'
          ? BbStatsController::class . '::projectStats'
          : BbProjectTabController::class . '::' . $tab,
        '_title_callback' => BbProjectTabController::class . '::title',
      ],
      ['_entity_access' => 'bb_project.view'],
      ['parameters' => ['bb_project' => ['type' => 'entity:bb_project']]],
    );
  }

  /**
   * The Settings tab's route.
   *
   * NOT part of `getTabRoute()`/`TAB_ROUTES`: that helper hard-codes a
   * `_controller` default and the `view` access gate every other tab shares.
   * Settings renders no controller at all — it is the project's own edit
   * form (`_entity_form: 'bb_project.settings'`) — and it keeps
   * the stricter `update` gate the other tabs do not need.
   */
  private function getSettingsRoute(): Route {
    return new Route(
      '/_workspace/{bb_workspace}/project/{bb_project}/settings',
      [
        '_entity_form' => 'bb_project.settings',
        '_title_callback' => BbProjectTabController::class . '::title',
      ],
      ['_entity_access' => 'bb_project.update'],
      ['parameters' => ['bb_project' => ['type' => 'entity:bb_project']]],
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    if ($route === NULL) {
      return NULL;
    }
    $defaults = $route->getDefaults();
    $defaults['_entity_view'] = 'bb_project.full';
    unset($defaults['_controller']);
    $defaults['_title_callback'] = BbProjectTabController::class . '::title';
    unset($defaults['_title'], $defaults['_title_callback_arguments']);
    $route->setDefaults($defaults);
    // Overview keeps the parent's `bb_project.view` requirement. Gating on
    // `view` also lets the workspace-mismatch converter answer a foreign
    // workspace's project with 404 rather than a 403.
    return $route;
  }

}
