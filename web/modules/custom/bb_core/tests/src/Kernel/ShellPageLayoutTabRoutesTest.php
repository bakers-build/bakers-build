<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Plugin\Condition\BbUserAreaRoute;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * Verifies the shipped standalone shell retains route coverage and local tabs.
 *
 * Reads the recipe/CIM profile and route providers. Browser navigation
 * and fragment replacement remain covered by the Playwright suite.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ShellPageLayoutTabRoutesTest extends KernelTestBase {

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
    'field', 'filter', 'markdown_easy', 'link', 'text', 'og',
    'views', 'better_exposed_filters', 'views_autocomplete_filters',
    'ui_patterns', 'ui_patterns_views', 'ui_patterns_field',
    'ui_patterns_field_formatters', 'field_ui', 'display_builder',
    'display_builder_entity_view',
    // `block` provides the `local_tasks_block` plugin the emitted config names,
    // and building that plugin is the one rendering assertion below.
    'block',
    // The retired page-layout module is absent from the standalone surface.
    'path_alias',
    'bb_core',
  ];

  /**
   * The team screen's five tab routes, Overview first.
   *
   * Overview is the DEFAULT local task and therefore IS the canonical route
   * (`BbTeamRouteProvider`), beside the two route-specific controller names
   * and the two native Views pages.
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
   * The emitted shell page layout, as the shipped file holds it.
   *
   * @var array<string, mixed>
   */
  private array $emitted;

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
    $this->installConfig(['system', 'user']);

    $file = dirname(__DIR__, 7)
      . '/config/sync/island.profile.bb_shell.yml';
    self::assertFileExists(
      $file,
      'The sync-to run must have emitted the shell page layout into config/sync.',
    );
    $emitted = Yaml::parseFile($file);
    self::assertIsArray($emitted);
    $this->emitted = $emitted;

    $this->installTicketNavigationViews();
    $this->installRunsNavigationViews();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Every tab route's path is covered by the emitted layout's own condition.
   *
   * Both sides are read: the pattern out of the emitted `conditions`, each path
   * out of the route provider. The matcher is core's own — the same service
   * `RequestPath::evaluate()` calls — so this resolves the condition rather
   * than re-implementing it.
   */
  public function testEveryTabRouteIsCoveredByTheEmittedLayoutsCondition(): void {
    $pages = $this->emittedRequestPathPattern();
    $matcher = $this->container->get('path.matcher');

    foreach (self::TAB_ROUTES as $route_name) {
      self::assertTrue(
        $matcher->matchPath($this->pathOf($route_name), $pages),
        sprintf(
          '%s (%s) must be covered by the emitted layout condition %s.',
          $route_name,
          $this->pathOf($route_name),
          $pages,
        ),
      );
    }
  }

  /**
   * Account-area routes get the account shell; other `/user/*` pages a shell.
   *
   * Both profiles cover the submission path. The account shell's
   * `bb_user_area_route` condition and its lower weight make it win there,
   * while `bb_shell` still covers `/user/*` pages outside the account area.
   */
  public function testSubmissionCanonicalUsesTheShell(): void {
    $file = dirname(__DIR__, 7) . '/config/sync/island.profile.bb_shell_account.yml';
    self::assertFileExists($file, 'The account-area shell profile must be emitted alongside bb_shell.');
    $account_emitted = Yaml::parseFile($file);
    self::assertIsArray($account_emitted);
    self::assertTrue(
      $account_emitted['conditions']['bb_user_area_route']['enabled'] ?? FALSE,
      'The account shell is selected by the bb_user_area_route condition.',
    );
    self::assertContains(
      'entity.bb_track_submission.canonical',
      BbUserAreaRoute::ROUTES,
      'The submission canonical route is in the user area the account shell covers.',
    );
    self::assertLessThan($this->emitted['weight'], $account_emitted['weight'], 'The account shell is selected ahead of bb_shell.');
    foreach (['/time/submission/6b0f6a52-5e6d-4b9e-8f43-0c6a1f9d2a11', '/user/6/cancel'] as $path) {
      self::assertTrue($this->container->get('path.matcher')->matchPath($path, $this->emittedRequestPathPattern()), $path);
    }
  }

  /**
   * The negative control: the emitted condition does not cover everything.
   *
   * Without it the assertion above would also hold for a condition of `/*`, and
   * the test would be measuring nothing.
   */
  public function testTheEmittedConditionDoesNotCoverAdminPaths(): void {
    $pages = $this->emittedRequestPathPattern();
    $matcher = $this->container->get('path.matcher');

    foreach (['/admin/config', '/', '/user'] as $path) {
      self::assertFalse(
        $matcher->matchPath($path, $pages),
        sprintf('%s must fall outside the emitted layout condition %s.', $path, $pages),
      );
    }
  }

  /**
   * The heading is its own island; the body island rides it along.
   */
  public function testTheEmittedLayoutCarriesTheHeadingIsland(): void {
    $header = $this->emittedPlacement('shell_page_header');
    self::assertSame('ui_patterns_component', $header['plugin_id']);
    self::assertSame('bb_theme:page_header', $header['configuration']['component']['component_id']);
    self::assertSame('bb_page_title', $header['configuration']['component']['props']['title']['source_id']);
    self::assertSame('block', $header['configuration']['component']['slots']['tabs']['sources'][0]['source_id']);
    self::assertSame('local_tasks_block', $header['configuration']['component']['slots']['tabs']['sources'][0]['source']['plugin_id']);
    self::assertSame('content', $header['slot']);
    self::assertSame(1, $header['weight']);
    self::assertTrue($header['configuration']['boost']);
    self::assertSame('shell_content_island', $header['configuration']['target_placement']);

    $content = $this->emittedPlacement('shell_content_island');
    self::assertSame('page_content', $content['plugin_id']);
    self::assertSame('content', $content['slot']);
    self::assertSame(2, $content['weight']);
    self::assertSame(['shell_page_header'], $content['configuration']['also_placements']);
    self::assertArrayNotHasKey('prefix_blocks', $content['configuration']);
    self::assertSame('shell_main', $content['configuration']['content_source_id']);

    $rail = $this->emittedPlacement('shell_rail');
    self::assertSame(['shell_page_header'], $rail['configuration']['also_placements']);
  }

  /**
   * The rail targets the content placement and keeps its real source mapping.
   *
   * BB-504 wrapped the rail: `bb_theme:nav` used to be the placement's own
   * `component`, and is now one slot of `bb_theme:sidebar` (the `navigation`
   * slot), which is the production surface the rail's collapse toggle,
   * workspace switcher and mode-toggle/account foot never had before this
   * ticket. The `bb_menu` items source moves with it rather than
   * disappearing, so this test follows it to its new address instead of
   * asserting the placement's own top-level `component` is still `nav`.
   */
  public function testTheEmittedLayoutWrapsTheRailInItsOwnIsland(): void {
    $rail = $this->emittedIsland('sidebar');
    self::assertSame('ui_patterns_component', $rail['plugin_id']);
    self::assertSame('shell_content_island', $rail['configuration']['target_placement']);
    self::assertTrue($rail['configuration']['boost']);
    self::assertSame('bb_theme:sidebar', $rail['configuration']['component']['component_id']);
    $navigation = $rail['configuration']['component']['slots']['navigation']['sources'][0]['source']['component'];
    self::assertSame('bb_theme:nav', $navigation['component_id']);
    self::assertSame('bb_menu', $navigation['props']['items']['source_id']);
    self::assertSame('bakers-rail', $navigation['props']['items']['source']['menu']);
  }

  /**
   * The API key create action is in the shell its page selects.
   *
   * The API key list is an account-area route, so only the account shell
   * renders on it.
   */
  public function testApiKeyCreateActionIsInTheAccountShell(): void {
    self::assertContains('view.bb_api_keys.page', BbUserAreaRoute::ROUTES);
    $actions = static function (string $profile): array {
      $data = Yaml::parseFile(dirname(__DIR__, 7) . "/config/sync/island.profile.$profile.yml");
      return array_column($data['placements']['shell_page_header']['configuration']['component']['slots']['actions']['sources'], 'source_id');
    };
    self::assertContains('bb_api_key_create_action', $actions('bb_shell_account'));
    self::assertNotContains('bb_api_key_create_action', $actions('bb_shell'));
  }

  /**
   * The team screen's local tasks are exactly the five tab routes.
   *
   * The heading island always builds `local_tasks_block`; what is measured is
   * the route set that block would render, so a drifted tab still fails.
   */
  public function testTheTeamLocalTasksAreExactlyTheFiveTabRoutes(): void {
    self::assertSame(
      'local_tasks_block',
      $this->emittedPlacement('shell_page_header')['configuration']['component']['slots']['tabs']['sources'][0]['source']['plugin_id'],
    );
    $manager = $this->container->get('plugin.manager.menu.local_task');

    $rendered = [];
    foreach ($manager->getLocalTasks('bb_core.bb_team.members', 0)['tabs'] as $tab) {
      $rendered[] = $tab['#link']['url']->getRouteName();
    }
    sort($rendered);
    $expected = self::TAB_ROUTES;
    sort($expected);

    self::assertSame(
      $expected,
      $rendered,
      'The local tasks the heading island renders are exactly the five tab routes.',
    );
  }

  /**
   * No block placement carries the shell, in either install path.
   *
   * The other side of the same claim, and the reason it is a file scan rather
   * than a runtime check: a hand-wired shell would leave a `block.block.*`
   * object behind, and the point is that none is shipped. Plan T1 seam 1
   * measured the same thing from the runtime side — `block.block.*` count 0
   * before and 0 after saving a page layout — so a placement here could only be
   * hand-written.
   */
  public function testNoBlockPlacementIsShippedForTheFrontEndTheme(): void {
    $root = dirname(__DIR__, 7);
    $theme = (string) (Yaml::parseFile($root . '/config/sync/system.theme.yml')['default'] ?? '');
    self::assertNotSame('', $theme, 'config/sync names a default theme.');

    foreach (glob($root . '/config/sync/block.block.*.yml') ?: [] as $file) {
      $placement = Yaml::parseFile($file);
      self::assertIsArray($placement);
      self::assertNotSame(
        $theme,
        $placement['theme'] ?? NULL,
        sprintf(
          '%s places a block in %s — the shell is the emitted page layout, not a placement.',
          basename($file),
          $theme,
        ),
      );
    }
  }

  /**
   * The emitted layout's request-path pattern, read from the shipped object.
   */
  private function emittedRequestPathPattern(): string {
    $pages = $this->emitted['conditions']['request_path']['pages'] ?? NULL;
    self::assertIsString($pages, 'The shipped profile carries a request_path condition.');
    return $pages;
  }

  /**
   * The standalone placement assigned to one slot of the shipped shell.
   *
   * @param string $slot
   *   The shell slot name.
   *
   * @return array<string, mixed>
   *   The placement with its plugin and preserved configuration.
   */
  private function emittedIsland(string $slot): array {
    $placements = array_filter($this->emitted['placements'], static fn(array $placement): bool => $placement['slot'] === $slot);
    self::assertCount(1, $placements, sprintf('The shell has one placement in %s.', $slot));
    return reset($placements);
  }

  /**
   * One named placement from the shipped profile.
   *
   * @param string $id
   *   The placement id.
   *
   * @return array<string, mixed>
   *   The placement record.
   */
  private function emittedPlacement(string $id): array {
    self::assertArrayHasKey($id, $this->emitted['placements']);
    $placement = $this->emitted['placements'][$id];
    self::assertIsArray($placement);
    return $placement;
  }

  /**
   * A concrete path for a route, with its parameters filled in.
   *
   * The path comes from the route provider rather than from a literal here, so
   * a route whose path moved out from under the emitted condition fails this
   * test instead of silently passing it.
   *
   * @param string $route_name
   *   The route to resolve.
   */
  private function pathOf(string $route_name): string {
    $path = $this->container->get('router.route_provider')
      ->getRouteByName($route_name)
      ->getPath();
    return str_replace(['{bb_workspace}', '{bb_team}'], ['bakers', '1'], $path);
  }

}
