<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\bb_core\Controller\BbProjectTabController;
use Drupal\bb_board\Plugin\views\style\BbBoard;
use Drupal\KernelTests\KernelTestBase;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * The project Board tab is a Views page, not a controller.
 */
#[Group('bb_core')]
final class ProjectBoardRouteTest extends KernelTestBase {

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
    'display_builder', 'ui_patterns', 'ui_patterns_views',
    'display_builder_views',
    'bb_core', 'bb_board',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installEntitySchema('bb_ticket');
    $this->installConfig(['system', 'search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.project_board');
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The Board tab lives under the workspace prefix.
   */
  public function testTheBoardRouteExistsUnderTheWorkspacePrefix(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('view.project_board.project_board');
    self::assertSame(
      '/_workspace/{bb_workspace}/project/{bb_project}/board',
      $route->getPath(),
    );
  }

  /**
   * The workspace slug is named, mapped and converted.
   */
  public function testTheWorkspaceSlugIsNamedMappedAndConverted(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('view.project_board.project_board');
    self::assertSame(
      'bb_core.paramconverter.workspace_slug',
      $route->getOption('parameters')['bb_workspace']['converter'] ?? NULL,
    );
  }

  /**
   * The Board route is not an admin route.
   */
  public function testTheBoardRouteIsNotAnAdminRoute(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('view.project_board.project_board');
    self::assertFalse((bool) $route->getOption('_admin_route'));
  }

  /**
   * The retired controller route is gone, and so is its method.
   */
  public function testTheControllerBoardRouteIsGone(): void {
    $this->expectException(RouteNotFoundException::class);
    $this->container->get('router.route_provider')
      ->getRouteByName('bb_core.bb_project.board');
  }

  /**
   * The tab controller no longer claims Board.
   */
  public function testTheTabControllerHasNoBoardMethod(): void {
    // ASKED THROUGH REFLECTION rather than `method_exists()`, because the
    // method is provably absent and static analysis then reports the call as
    // always-false — which would make the deletion unassertable at all.
    self::assertFalse(
      (new \ReflectionClass(BbProjectTabController::class))->hasMethod('board'),
    );
  }

  /**
   * The tab hangs off the project's canonical route.
   */
  public function testTheBoardTabIsDeclaredOnTheCanonicalRoute(): void {
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    self::assertSame(
      'entity.bb_project.canonical',
      $tasks['view.project_board.project_board']['base_route'],
    );
  }

  /**
   * The shipped view is four paged columns attached to the Board page.
   */
  public function testTheShippedViewIsFourPagedColumns(): void {
    $view = View::load('project_board');
    self::assertNotNull($view);
    $default = $view->getDisplay('default');
    self::assertSame('none', $default['display_options']['access']['type']);
    self::assertSame('bb_board', $default['display_options']['style']['type']);
    $style = $this->container->get('plugin.manager.views.style')->createInstance('bb_board');
    self::assertInstanceOf(BbBoard::class, $style);
    self::assertTrue($style->evenEmpty());
    // ui_patterns view_rows re-renders getField() when this option is true,
    // so the board style never runs. Tickets' bb_list keeps the same false.
    self::assertFalse($default['display_options']['style']['options']['uses_fields']);
    self::assertSame('search_api_index_bb_tickets', $view->get('base_table'));
    self::assertSame('search_api_id', $view->get('base_field'));
    self::assertSame('search_api_query', $default['display_options']['query']['type']);
    self::assertArrayNotHasKey('board_assignee', $default['display_options']['filters']);
    // People are filtered by the Assignee chips; a Conductor filter would say
    // the same twice.
    self::assertArrayNotHasKey('board_conductor', $default['display_options']['filters']);
    self::assertSame('parent_id', $default['display_options']['filters']['board_parent']['expose']['identifier']);
    foreach (['facets_state', 'facets_assignee_user_id', 'facets_priority', 'facets_work_state'] as $facet) {
      self::assertArrayHasKey($facet, $default['display_options']['filters']);
    }
    self::assertArrayNotHasKey('search_api_fulltext', $default['display_options']['filters']);
    self::assertArrayNotHasKey('work_state', $default['display_options']['filters']);
    $bef = $view->getDisplay('project_board')['display_options']['exposed_form']['options']['bef']['filter'] ?? [];
    self::assertArrayHasKey('board_parent', $bef);
    self::assertArrayHasKey('facets_state', $bef);
    self::assertArrayHasKey('facets_assignee_user_id', $bef);
    self::assertArrayHasKey('facets_priority', $bef);
    self::assertArrayHasKey('facets_work_state', $bef);
    $page = $view->getDisplay('project_board');
    self::assertSame(
      '_workspace/%bb_workspace/project/%bb_project/board',
      $page['display_options']['path'],
    );
    self::assertSame('some', $page['display_options']['pager']['type']);
    self::assertSame(1, $page['display_options']['pager']['options']['items_per_page']);
    $pagers = [];
    foreach (['backlog', 'intake', 'working', 'done'] as $id) {
      $column = $view->getDisplay($id);
      self::assertSame('bb_board_column', $column['display_plugin']);
      self::assertSame('mini', $column['display_options']['pager']['type']);
      self::assertSame(10, $column['display_options']['pager']['options']['items_per_page']);
      self::assertTrue($column['display_options']['inherit_exposed_filters']);
      self::assertSame(
        'project_board',
        $column['display_options']['displays']['project_board'],
      );
      $pagers[] = $column['display_options']['pager']['options']['id'];
    }
    self::assertSame([0, 1, 2, 3], $pagers);
    self::assertSame('Not assigned', $view->getDisplay('backlog')['display_options']['title']);
    self::assertSame('Not assigned', $view->getDisplay('backlog')['display_title']);
    $placement = [
      'backlog' => 'not_assigned',
      'intake' => 'intake',
      'working' => 'working',
      'done' => 'done',
    ];
    foreach ($placement as $id => $value) {
      $filters = $view->getDisplay($id)['display_options']['filters'];
      self::assertArrayNotHasKey('board_column', $filters);
      self::assertArrayNotHasKey('closed', $filters);
      self::assertArrayNotHasKey('conductor_id', $filters);
      self::assertArrayNotHasKey('state', $filters);
      self::assertArrayHasKey('facets_work_state', $filters);
      self::assertFalse($filters['work_state']['exposed']);
      self::assertSame('=', $filters['work_state']['operator']);
      self::assertSame($value, $filters['work_state']['value']['value']);
    }
    self::assertSame('closed_date', $view->getDisplay('done')['display_options']['sorts']['closed_date']['id']);
    self::assertSame('search_api', $view->getDisplay('done')['display_options']['sorts']['closed_date']['plugin_id']);
    self::assertSame('DESC', $view->getDisplay('done')['display_options']['sorts']['closed_date']['order']);
    self::assertSame(2, $view->getDisplay('backlog')['position']);
    self::assertSame(3, $view->getDisplay('intake')['position']);
    self::assertSame(4, $view->getDisplay('working')['position']);
    self::assertSame(5, $view->getDisplay('done')['position']);
  }

}
