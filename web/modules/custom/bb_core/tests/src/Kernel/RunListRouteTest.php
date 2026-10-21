<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The runs VIEW owns the two Runs tabs, and no controller of ours does.
 *
 * Written after Task 3's config so it pins what must stay true rather than
 * what was just built. Mirrors TicketListRouteTest for the runs equivalent.
 */
#[Group('bb_core')]
final class RunListRouteTest extends KernelTestBase {

  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'views_filters_summary',
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
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('bb_ticket');
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.runs');
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Both run routes exist under the workspace prefix.
   */
  public function testBothRunRoutesExistUnderTheWorkspacePrefix(): void {
    $provider = $this->container->get('router.route_provider');
    foreach ([
      'view.runs.project_runs' => '/_workspace/{bb_workspace}/project/{bb_project}/runs',
      'view.runs.team_runs' => '/_workspace/{bb_workspace}/team/{bb_team}/runs',
    ] as $name => $path) {
      self::assertSame($path, $provider->getRouteByName($name)->getPath());
    }
  }

  /**
   * The workspace slug is named, mapped and converted.
   */
  public function testTheWorkspaceSlugIsNamedMappedAndConverted(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName('view.runs.project_runs');
    self::assertSame(
      'bb_core.paramconverter.workspace_slug',
      $route->getOption('parameters')['bb_workspace']['converter'] ?? NULL,
    );
  }

  /**
   * Neither run route is an admin route.
   */
  public function testTheRunRoutesAreNotAdminRoutes(): void {
    $provider = $this->container->get('router.route_provider');
    foreach (['view.runs.project_runs', 'view.runs.team_runs'] as $name) {
      self::assertFalse((bool) $provider->getRouteByName($name)->getOption('_admin_route'));
    }
  }

  /**
   * No controller and no island claims the Runs tabs.
   */
  public function testNoControllerAndNoIslandClaimsTheRunsTabs(): void {
    self::assertFalse(class_exists('Drupal\bb_core\Controller\BbRunListController'));
    self::assertFalse(class_exists('Drupal\bb_core\Island\BbRunsIslandHost'));
  }

  /**
   * Both tabs are declared as local tasks on their entity's canonical route.
   */
  public function testBothTabsAreDeclaredAsLocalTasks(): void {
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    self::assertSame('entity.bb_project.canonical', $tasks['view.runs.project_runs']['base_route']);
    self::assertSame('entity.bb_team.canonical', $tasks['view.runs.team_runs']['base_route']);
  }

}
