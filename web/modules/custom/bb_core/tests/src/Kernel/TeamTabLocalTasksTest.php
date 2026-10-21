<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;

/**
 * The five team tabs, and the reason they are local tasks (BB-396 D8/T9).
 *
 * WHAT THIS IS NOT. The plan's T9 asks for a `local_tasks` **ui_patterns source
 * plugin**. That plugin does not exist: spec D8 was redecided on 2026-08-30
 * to a PRESENTER TEMPLATE over Drupal's own `local_tasks_block`, and the spec
 * records the source as *"written and then deleted"* (spec lines 476-477). D9,
 * which the source dragged behind it, is WITHDRAWN outright (spec line 489).
 * So there is no source to test, and this class does not invent one.
 *
 * WHAT SURVIVED IS THE PROPERTY, and it is worth more than the plugin was. The
 * whole reason the mechanism is local tasks rather than menu links is stated in
 * the spec's own rejection of the alternative: *"the five tabs carry
 * `{bb_workspace}` and `{bb_team}`, a local task inherits those from the
 * route match and a stored menu link cannot"* (D8, F24/F25). That inheritance
 * is what this class pins, together with the active trail — the two things the
 * presenter template reads and the two things a reshuffle of the route provider
 * would silently break. The Settings face BB-499 added left again when the
 * name moved onto Overview's Identity card; neither changed the mechanism.
 *
 * WHY NOT IN `ShellPageLayoutTabRoutesTest`. That class asks whether the
 * EMITTED page layout names the right block plugin, and it reads the tabs once,
 * from one route, as route NAMES. Neither the per-route active trail nor the
 * parameters on the built URLs is visible there, and both are what the tab bar
 * renders from.
 *
 * ONE LOCAL TASK IS THE CANONICAL ROUTE: Overview is the DEFAULT task
 * (BB-454, replacing Load), so `/team/{id}` is Overview's own address
 * rather than a redirect to it.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TeamTabLocalTasksTest extends KernelTestBase {

  use UserCreationTrait;
  use TicketNavigationViewsTrait;
  use RunsNavigationViewsTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'bb_core', 'views',
  ];

  /**
   * The five faces, Overview first — Overview being the canonical route itself.
   *
   * @var array<string>
   */
  private const TAB_ROUTES = [
    'entity.bb_team.canonical',
    'bb_core.bb_team.stats',
    'view.tickets.team_tickets',
    'view.runs.team_runs',
    'bb_core.bb_team.members',
  ];

  /**
   * The team Tickets task is a primary tab alongside the other team faces.
   */
  private const TICKETS_ROUTE = 'view.tickets.team_tickets';

  /**
   * The ambient workspace.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The team every tab addresses.
   */
  private BbTeamInterface $team;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    // Layer A resolves the account's ranks on every permission check, so any
    // test booting bb_core needs the membership schema even when it never
    // mentions a group.
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installConfig(['system', 'user']);
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->installTicketNavigationViews();
    $this->installRunsNavigationViews();
    $this->container->get('router.builder')->rebuild();

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    $this->team = $team;
  }

  /**
   * On each of the five routes the bar carries all five, exactly one active.
   *
   * Asserted per route rather than once, because "exactly one active" is a
   * about the ROUTE MATCH: a single-route check passes against a provider that
   * marks the same task active everywhere, which is precisely the shape of a
   * broken `base_route`.
   */
  public function testEachRouteCarriesFiveTabsWithExactlyItselfActive(): void {
    foreach (self::TAB_ROUTES as $route_name) {
      $tabs = $this->tabsOn($route_name);

      self::assertSame(
        self::TAB_ROUTES,
        array_keys($tabs),
        sprintf('On %s the tab bar carries all five faces.', $route_name),
      );

      $active = array_keys(array_filter($tabs, static fn(array $tab): bool => $tab['active']));
      self::assertSame(
        [$route_name],
        $active,
        sprintf('On %s exactly that tab is in the active trail.', $route_name),
      );
    }
  }

  /**
   * Every tab's URL inherits the route parameters from the route match.
   *
   * This is D8's whole ground for choosing local tasks, and it is the assertion
   * a stored menu link could not satisfy: the parameters are not configured
   * anywhere, they come from the request. A task whose URL lost them would
   * render as a tab, and clicking it would 404 or land on another team.
   */
  public function testEveryTabInheritsTheWorkspaceAndTeamFromTheRouteMatch(): void {
    foreach (self::TAB_ROUTES as $route_name) {
      foreach ($this->tabsOn($route_name) as $tab_route => $tab) {
        self::assertSame(
          [
            'bb_workspace' => $this->workspace->getSlug(),
            'bb_team' => $this->team->id(),
          ],
          $tab['parameters'],
          sprintf('%s, seen from %s, carries the ambient team and workspace.', $tab_route, $route_name),
        );
      }
    }
  }

  /**
   * The negative control: another team's route moves every tab with it.
   *
   * Without it the assertion above would also hold for a provider that
   * one team's id, and the test would be measuring a constant.
   */
  public function testTheTabsFollowTheTeamTheRequestIsOn(): void {
    $other = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Design Crew', 'workspace_id' => $this->workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $other);
    $other->save();

    $ids = [];
    foreach ($this->tabsOn('bb_core.bb_team.members', $other) as $tab) {
      $ids[] = $tab['parameters']['bb_team'];
    }

    self::assertSame([$other->id()], array_unique($ids));
    self::assertNotSame($this->team->id(), $other->id(), 'The two teams are distinct.');
  }

  /**
   * Tickets is registered as a primary task with a stable order.
   *
   * Read off the actual local task manager rather than by instantiating a
   * provider class: `bb_core.links.task.yml` (BB-454) declares the tabs
   * statically, so there is no provider object left to construct.
   */
  public function testTicketsIsPrimaryTask(): void {
    $tabs = $this->tabsOn(self::TICKETS_ROUTE);

    self::assertArrayHasKey(self::TICKETS_ROUTE, $tabs);
  }

  /**
   * The five tabs as the presenter template reads them, on one route.
   *
   * Reduced to the two facts the template uses — `#active` and the built URL's
   * route parameters — and keyed by route name, so a failure names the tab.
   *
   * @param string $route_name
   *   The route the request is on.
   * @param \Drupal\bb_core\Entity\BbTeamInterface|null $team
   *   The team in the route match, defaulting to the fixture's.
   *
   * @return array<string, array<string, mixed>>
   *   Per tab: `active` and `parameters`.
   */
  private function tabsOn(string $route_name, ?BbTeamInterface $team = NULL): array {
    $this->enterRoute($route_name, $team ?? $this->team);
    // A fresh manager per request: LocalTaskManager caches its built tasks
    // against the route match it was asked on, so a reused instance answers
    // for the previous route and every case here would agree with the first.
    $manager = $this->container->get('plugin.manager.menu.local_task');
    $manager->clearCachedDefinitions();

    $tabs = [];
    foreach ($manager->getLocalTasks($route_name, 0)['tabs'] as $tab) {
      $url = $tab['#link']['url'];
      $tabs[$url->getRouteName()] = [
        'active' => (bool) ($tab['#active'] ?? FALSE),
        'parameters' => $url->getRouteParameters(),
      ];
    }
    return $tabs;
  }

  /**
   * Makes a route the current one, carrying the workspace and the team.
   *
   * Staged as a real request with a real route object: `CurrentRouteMatch`
   * answers with a `NullRouteMatch` for anything less, and a local task built
   * off a null match is exactly the parameter-less tab this class forbids.
   */
  private function enterRoute(string $route_name, BbTeamInterface $team): void {
    $provider = $this->container->get('router.route_provider');
    $route = $provider->getRouteByName($route_name);
    $path = str_replace(
      ['{bb_workspace}', '{bb_team}'],
      [$this->workspace->getSlug(), (string) $team->id()],
      $route->getPath(),
    );
    $request = Request::create($path);
    // Carry the harness's session over: anything reading the current user off
    // the request would otherwise hit SessionNotFoundException on this one.
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $request->attributes->set('bb_team', $team);
    // The RAW variables as well, and they are not decoration here: a local task
    // is access-checked with `$routeMatch->getRawParameters()`, which the
    // parameter converter then loads entities from. Upcast objects alone make
    // try to load an entity whose id IS an entity, which is a TypeError rather
    // than a failed assertion — so a request staged without them cannot reach
    // any claim this class makes.
    $request->attributes->set('_raw_variables', new ParameterBag([
      'bb_workspace' => $this->workspace->getSlug(),
      'bb_team' => (string) $team->id(),
    ]));
    $this->container->get('request_stack')->push($request);
  }

}
