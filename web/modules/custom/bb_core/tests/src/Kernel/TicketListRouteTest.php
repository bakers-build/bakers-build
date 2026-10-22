<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The tickets VIEW owns `/{workspace}/tickets`, and no controller of ours does.
 *
 * THIS FILE WAS THE OPPOSITE ASSERTION UNTIL 2026-09-04, and the reversal is
 * the human's: "`BbTicketListController.php` is not needed — use a view route
 * and have the canvas rendered inside the view; that should all work through
 * the display builder." So `bb_core.tickets` is deleted and the page display
 * is back, and the guard is inverted rather than dropped: a future dispatch
 * that re-adds a controller at this path fails here and reads why.
 *
 * THE PLACEHOLDER IS NAMED, AND THAT IS THE WHOLE OF THE PATH ASSERTION.
 * `PathPluginBase::getRoute()` turns a bare `%` into `{arg_0}` and a NAMED `%x`
 * into `{x}` with `_view_argument_map[arg_0] = 'x'`. Only the named form gives
 * this route the `{bb_workspace}` slot that `BbWorkspaceRouteSubscriber`
 * matches by path — the converter, the slug pattern, `_bb_workspace_match`
 * and `_admin_route: FALSE` all hang off it — and only the map makes
 * `ViewPageController::handle()` pass the slug into `$view->args`, which is
 * what lets `ViewsExposedForm` address the form at the page the reader is on
 * instead of at the wildcard form of this path. With `{arg_0}` the parameter is
 * unnamed, the subscriber still matches nothing of it, and the exposed form
 * substitutes a wildcard for the slot and throws
 * `InvalidParameterException` against the slug pattern — a 500, measured.
 */
#[Group('bb_core')]
final class TicketListRouteTest extends KernelTestBase {

  use ProjectsViewTestTrait;

  /**
   * The route the view registers for the nav home.
   *
   * IT MOVED FROM `page_1` TO `my_work` ON 2026-09-04, when the human decided
   * that a filtered variant of the ticket list is a DISPLAY with real filters
   * rather than the same display reached with facet defaults. `my_work` took
   * `/{workspace}/tickets` and the full find-a-ticket table moved to
   * `/{workspace}/tickets/all`.
   */
  private const ROUTE = 'view.tickets.my_work';

  /**
   * All routed displays, keyed by route name, with the path each claims.
   *
   * EVERY ASSERTION BELOW RUNS OVER ALL FOUR. The slug slot's treatment — the
   * converter, the map, `_bb_workspace_match`, `_admin_route: FALSE` — comes
   * from `BbWorkspaceRouteSubscriber` matching the PATH, so a second display
   * added under the prefix inherits it silently and a test that only checked
   * the first would never notice it stopping.
   *
   * @var array<string, string>
   */
  private const ROUTES = [
    'view.tickets.my_work' => '/_workspace/{bb_workspace}/tickets',
    'view.tickets.page_1' => '/_workspace/{bb_workspace}/tickets/all',
    'view.tickets.project_tickets' => '/_workspace/{bb_workspace}/project/{bb_project}/tickets',
    'view.tickets.team_tickets' => '/_workspace/{bb_workspace}/team/{bb_team}/tickets',
  ];

  /**
   * {@inheritdoc}
   *
   * The view has to be installable for its route to exist at all, so this
   * carries the module set `TicketsViewConfigTest` measured — `og` for
   * `bb_core.workspace_read_scope`, the view's own `better_exposed_filters` /
   * `facets_exposed_filters` dependencies, `facets` for the query-type manager
   * the exposed handler asks for, and `search_api_db` for the server.
   *
   * `island` IS DELIBERATELY ABSENT. This screen registers no island of its
   * own, so a module list carrying `island` would let a dependency on it come
   * back unnoticed.
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    // `views_filters_summary` states the chosen facets above the rows
    // (BB-413, 2026-09-04) and the view names it in
    // `dependencies.module`, so the optional config installer refuses the
    // view without it — the symptom is "The tickets view is not installed".
    'views_filters_summary',
    // The view's page display carries a `display_builder` display extender, and
    // that extender's SCHEMA lives in `display_builder_views`. Without the
    // module the view is not merely unrendered — it will not install at all:
    // `ConfigSchemaChecker` rejects
    // `display.page_1.display_options.display_extenders.display_builder` as
    // "missing schema". So this list is a true statement of what the shipped
    // config needs, not a convenience.
    'display_builder', 'ui_patterns', 'ui_patterns_views',
    'display_builder_views',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installEntitySchema('bb_ticket');
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
    // The router is not built by a Kernel test's module install, and a Views
    // page display registers its route during the build.
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * All of the view's routes sit under the internal workspace prefix.
   */
  public function testTheViewRoutesExistUnderTheWorkspacePrefix(): void {
    foreach (self::ROUTES as $name => $path) {
      self::assertSame(
        $path,
        $this->container->get('router.route_provider')
          ->getRouteByName($name)
          ->getPath(),
      );
    }
  }

  /**
   * No controller of ours claims this path any more.
   */
  public function testTheControllerRouteIsGone(): void {
    foreach (self::ROUTES as $expected => $path) {
      $names = [];
      foreach ($this->container->get('router.route_provider')
        ->getRoutesByPattern($path)
        ->all() as $name => $unused) {
        $names[] = $name;
      }

      self::assertSame(
        [$expected],
        $names,
        'Two routes claim ' . $path . '; which one answers is then a matter of route fit.',
      );
    }
    self::assertFalse(
      class_exists('Drupal\\bb_core\\Controller\\BbTicketListController'),
      'The list controller is back; the view owns this screen now.',
    );
  }

  /**
   * The slug slot is named, mapped and converted.
   *
   * Three readings of one fact, because each of them fails differently: an
   * unnamed slot loses the subscriber's treatment, an unmapped one loses
   * `$view->args` and with it the form action, and an unconverted one hands
   * `_bb_workspace_match` a string instead of a workspace.
   */
  public function testTheWorkspaceSlotIsNamedMappedAndConverted(): void {
    foreach (array_keys(self::ROUTES) as $name) {
      $route = $this->container->get('router.route_provider')->getRouteByName($name);

      $map = ['arg_0' => 'bb_workspace'];
      if ($name === 'view.tickets.project_tickets') {
        $map['arg_1'] = 'bb_project';
      }
      elseif ($name === 'view.tickets.team_tickets') {
        $map['arg_1'] = 'bb_team';
      }
      self::assertSame(
        $map,
        $route->getOption('_view_argument_map'),
        $name . ': without the map ViewPageController passes no slug and the form action becomes /_workspace/*/tickets.',
      );
      self::assertSame(
        'bb_core.paramconverter.workspace_slug',
        $route->getOption('parameters')['bb_workspace']['converter'] ?? NULL,
        $name . ': an unconverted slot hands _bb_workspace_match a string.',
      );
      self::assertSame('TRUE', $route->getRequirement('_bb_workspace_match'), $name);
    }
  }

  /**
   * It is not an admin route, so it keeps bb_theme and the shell.
   */
  public function testItIsNotAnAdminRoute(): void {
    foreach (array_keys(self::ROUTES) as $name) {
      $route = $this->container->get('router.route_provider')->getRouteByName($name);
      self::assertFalse(
        (bool) $route->getOption('_admin_route'),
        $name . ': an admin route would resolve to Gin and lose the shell.',
      );
    }
    $route = $this->container->get('router.route_provider')
      ->getRouteByName(self::ROUTE);

    // _admin_route would resolve the page to Gin and lose the shell, whose
    // page layout is conditioned on request_path /_workspace/*.
    //
    // FALSE rather than absent: `BbWorkspaceRouteSubscriber::makeFrontEnd()`
    // stamps every workspace-prefixed route with `_admin_route: FALSE` on
    // purpose — "set to FALSE rather than unset, so a later ALTER subscriber
    // cannot read 'no opinion' and stamp TRUE back on".
    self::assertFalse(
      (bool) $route->getOption('_admin_route'),
      'An admin route would resolve to Gin and lose the shell.',
    );
  }

  /**
   * This screen registers no island host and no island plugin.
   *
   * The rule, unchanged by the move back to a view route: register an island
   * host and a plugin only where the screen declares a real partial update of
   * its own. This screen never did — the deleted `TicketList::boost()` returned
   * NULL, so the plugin contributed no htmx at all — and the boost it enjoys
   * belongs to the shell's content island, which is untouched.
   */
  public function testThisScreenRegistersNoIslandHostAndNoIslandPlugin(): void {
    self::assertFalse(
      class_exists('Drupal\\bb_core\\Plugin\\Island\\TicketList'),
      'The ticket list island plugin is back; its boost() was always NULL.',
    );
    self::assertFalse(
      class_exists('Drupal\\bb_core\\Island\\BbTicketsIslandHost'),
      'The ticket list island host is back; nothing addresses this screen as an island.',
    );
    self::assertFalse(
      $this->container->has('bb_core.tickets_island_host'),
      'The island host service is back.',
    );
  }

  /**
   * Only the rail and the account link claim this route, both `bb_core`.
   *
   * My work in `bakers-rail` and Back to workspace in `bakers-account`. A
   * renamed route would leave both links silently inaccessible, so the claim is
   * asserted by name.
   */
  public function testOnlyTheRailAndAccountLinksClaimTheViewRoute(): void {
    $definitions = $this->container->get('plugin.manager.menu.link')->getDefinitions();

    self::assertArrayHasKey(
      'bb_core.rail.my_work',
      $definitions,
      'bb_core no longer declares the My work rail link.',
    );
    self::assertSame(self::ROUTE, $definitions['bb_core.rail.my_work']['route_name'] ?? NULL);
    self::assertSame('bakers-rail', $definitions['bb_core.rail.my_work']['menu_name'] ?? NULL);
    $claimants = array_keys(array_filter(
      $definitions,
      static fn (array $definition): bool => ($definition['route_name'] ?? NULL) === self::ROUTE,
    ));
    sort($claimants);
    self::assertSame(
      ['bb_core.account.back_to_workspace', 'bb_core.rail.my_work'],
      $claimants,
      'Only the rail and account-area back-to-workspace links may claim the My work route.',
    );
  }

}
