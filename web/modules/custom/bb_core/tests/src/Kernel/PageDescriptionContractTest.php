<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Plugin\Condition\BbUserAreaRoute;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Routing\Route;
use Symfony\Component\Yaml\Yaml;

/**
 * Every shell page route carries a one-sentence `_description` default.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class PageDescriptionContractTest extends KernelTestBase {

  use ProjectsViewTestTrait;

  /**
   * Routes whose header line is dynamic and so carry no `_description`.
   *
   * Ticket routes (with `{bb_ticket}`, other than the run routes) show the
   * ticket sub-line; the project and the insights page show a computed line.
   */
  private const DYNAMIC = [
    'entity.bb_project.canonical',
    'bb_core.workspace.insights',
  ];

  /**
   * Routes inside the shell path prefixes that are not pages, with the reason.
   *
   * Generic filters (no GET, non-HTML `_format`, the gate paths) are code in
   * isPage().
   *
   * @var array<string, string>
   */
  private const NOT_PAGES = [
    'bb_core.run_log_download' => 'A file download, not a page.',
    'bb_core.bb_machine.edit_retired' => 'A retired URL that only redirects to the machine page.',
  ];

  /**
   * {@inheritdoc}
   *
   * A module that adds shell routes must be listed here.
   *
   * @var array<string>
   */
  protected static $modules = [
    'path_alias', 'file', 'image', 'datetime', 'editor', 'jsonapi', 'serialization',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'display_builder', 'ui_patterns', 'ui_patterns_views',
    'display_builder_views', 'plugin', 'views_filters_summary', 'consumers', 'simple_oauth',
    'jsonapi_resources', 'markdown_easy', 'simple_oauth_server_metadata',
    'island',
    'bb_core', 'bb_api_key', 'bb_ticket_trigger', 'bb_track', 'bb_webhook',
    'bb_board', 'bb_activity', 'bb_addon', 'bb_inbox',
  ];

  /**
   * Routes that must be in the page set, so the test cannot pass vacuously.
   */
  private const KNOWN_PAGES = [
    'view.tickets.my_work',
    'entity.bb_ticket.add_form',
    'bb_core.user.profile',
    'view.worklog.page',
  ];

  /**
   * The shipped views with a page display under a shell path prefix.
   *
   * Every one installs in a kernel test; a view that cannot would need an
   * explicit skip here, with its reason.
   *
   * @return array<int, string>
   *   Config object names, e.g. `views.view.tickets`.
   */
  private static function shellViews(): array {
    $names = [];
    foreach (glob(dirname(__DIR__, 7) . '/recipes/bakers/config/views.view.*.yml') ?: [] as $file) {
      $name = basename($file, '.yml');
      foreach (Yaml::parseFile($file)['display'] ?? [] as $display) {
        $path = $display['display_options']['path'] ?? '';
        if (($display['display_plugin'] ?? '') === 'page'
          && preg_match('#^(_workspace/|user/|time/submission/)#', $path)) {
          $names[] = $name;
          break;
        }
      }
    }
    return $names;
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('path_alias');
    $this->installEntitySchema('search_api_task');
    $this->installEntitySchema('bb_ticket');
    $this->installConfig(['system', 'search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    foreach (self::shellViews() as $view) {
      $this->installShippedView($view);
    }
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Whether the route is a shell page the header describes.
   */
  private function isPage(string $name, Route $route): bool {
    $path = $route->getPath();
    $inShell = str_starts_with($path, '/_workspace/{bb_workspace}')
      || str_starts_with($path, '/user/{user}')
      || str_starts_with($path, '/time/submission/')
      || in_array($name, BbUserAreaRoute::ROUTES, TRUE)
      || $route->getOption('_bb_user_area');
    if (!$inShell || isset(self::NOT_PAGES[$name])) {
      return FALSE;
    }
    // Not a page: a route that cannot be fetched with GET.
    $methods = $route->getMethods();
    if ($methods !== [] && !in_array('GET', $methods, TRUE)) {
      return FALSE;
    }
    // Not a page: JSON, XML and other non-HTML formats.
    $format = $route->getRequirement('_format');
    if ($format !== NULL && $format !== 'html') {
      return FALSE;
    }
    // Not pages: the sign-in gate paths render no shell header.
    if (preg_match('#^/user/(login|logout|register|check-mail|reset/)#', $path)) {
      return FALSE;
    }
    return TRUE;
  }

  /**
   * Whether the header line of this page is dynamic, not a route default.
   */
  private function isDynamic(string $name, Route $route): bool {
    if (in_array($name, self::DYNAMIC, TRUE)) {
      return TRUE;
    }
    return str_contains($route->getPath(), '{bb_ticket}')
      && !str_starts_with($name, 'entity.bb_run.');
  }

  /**
   * Every shell page route has a description.
   */
  public function testEveryShellPageHasDescription(): void {
    $missing = [];
    $pages = [];
    foreach ($this->container->get('router.route_provider')->getAllRoutes() as $name => $route) {
      if (!$this->isPage($name, $route)) {
        continue;
      }
      $pages[] = $name;
      if ($this->isDynamic($name, $route)) {
        continue;
      }
      $description = $route->getDefault('_description');
      if (!is_string($description) || trim($description) === '') {
        $missing[$name] = $route->getPath();
      }
    }
    self::assertSame([], array_diff(self::KNOWN_PAGES, $pages), 'Known pages are missing from the page set.');
    ksort($missing);
    self::assertSame(
      [],
      $missing,
      count($missing) . " shell page routes have no _description:\n"
      . implode("\n", array_map(
        static fn (string $n, string $p): string => "$n  $p",
        array_keys($missing),
        $missing,
      )),
    );
  }

  /**
   * Every description is one short sentence, with no placeholder.
   */
  public function testEveryDescriptionFollowsTheRule(): void {
    $broken = [];
    foreach ($this->container->get('router.route_provider')->getAllRoutes() as $name => $route) {
      $description = $route->getDefault('_description');
      if ($description === NULL) {
        continue;
      }
      if (!is_string($description)
        || !str_ends_with($description, '.')
        || strlen($description) > 120
        || str_contains($description, '@')
        || str_contains($description, '. ')) {
        $broken[$name] = (string) json_encode($description);
      }
    }
    self::assertSame([], $broken, 'Descriptions that break the rule: ' . print_r($broken, TRUE));
  }

}
