<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Controller\BbStatsController;
use Drupal\bb_core\Controller\BbTeamTabController;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/**
 * The controller-backed routes of the team screen.
 *
 * Emits the Stats, Members and Settings tabs; Tickets and Runs are Views
 * pages. The canonical route (Overview, the default local task) stays core's
 * `_entity_view: bb_team.full`; only its title callback is replaced. Do not
 * add a controller that merely renders the view mode.
 *
 * The route names are a contract: tests and `bb_core.links.task.yml`
 * address them by name. Members (an `og_membership` query plus add form) and
 * Stats (a cross-entity figure set) cannot be view modes, so they keep a
 * `_controller`.
 */
final class BbTeamRouteProvider extends AdminHtmlRouteProvider {

  /**
   * The controller-backed tabs, named `bb_core.bb_team.<tab>`.
   *
   * The controller method carries the same name as the tab, which is what lets
   * one loop emit both; `bb_core.links.task.yml` names its own route names
   * from the same convention.
   *
   * @var array<string>
   */
  private const TAB_ROUTES = ['stats', 'members'];

  /**
   * {@inheritdoc}
   */
  public function getRoutes(EntityTypeInterface $entity_type): RouteCollection {
    $collection = parent::getRoutes($entity_type);
    foreach (self::TAB_ROUTES as $tab) {
      $collection->add('bb_core.bb_team.' . $tab, $this->getTabRoute($tab));
    }
    $collection->add('bb_core.bb_team.settings', $this->getSettingsRoute());
    return $collection;
  }

  /**
   * One route-specific tab's route.
   *
   * The workspace prefix is on every product route and
   * `_workspace` never appears in a URL — `BbWorkspacePathProcessor` bridges
   * the public `/{slug}/…` form in both directions.
   *
   * Every tab gates on `_entity_access: bb_team.view`, Stats included:
   * statistics are permissioned per figure, so the tab follows the entity and
   * the figures filter themselves.
   *
   * @param string $tab
   *   The tab's machine name, which is also the controller method's name.
   *
   * @return \Symfony\Component\Routing\Route
   *   The route.
   */
  private function getTabRoute(string $tab): Route {
    $requirements = ['_entity_access' => 'bb_team.view'];
    return new Route(
      '/_workspace/{bb_workspace}/team/{bb_team}/' . $tab,
      [
        // Stats is the ONE tab served by the shared stats controller, which
        // reads its scope from `_bb_stats_scope`. Every other
        // tab keeps its own method on this entity's tab controller.
        '_controller' => $tab === 'stats'
          ? BbStatsController::class . '::stats'
          : BbTeamTabController::class . '::' . $tab,
        '_title_callback' => BbTeamTabController::class . '::title',
      ] + ($tab === 'stats' ? ['_bb_stats_scope' => 'bb_team'] : []),
      $requirements,
      ['parameters' => ['bb_team' => ['type' => 'entity:bb_team']]],
    );
  }

  /**
   * The Settings tab's route.
   *
   * Carries the `bb_team.settings` entity form rather than a controller,
   * and gates on `bb_team.update` because Settings is an edit surface.
   *
   * @return \Symfony\Component\Routing\Route
   *   The route.
   */
  private function getSettingsRoute(): Route {
    return new Route(
      '/_workspace/{bb_workspace}/team/{bb_team}/settings',
      [
        '_entity_form' => 'bb_team.settings',
        '_title_callback' => BbTeamTabController::class . '::title',
      ],
      ['_entity_access' => 'bb_team.update'],
      ['parameters' => ['bb_team' => ['type' => 'entity:bb_team']]],
    );
  }

  /**
   * {@inheritdoc}
   *
   * Core's canonical route, with only its TITLE callback replaced.
   *
   * `EntityController::title()` titles the FIRST entity parameter, and on
   * `/_workspace/{bb_workspace}/team/{bb_team}` that is the workspace.
   * The body is unaffected: `_entity_view` resolves its subject by key.
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    $route?->setDefault('_title_callback', BbTeamTabController::class . '::title');
    return $route;
  }

}
