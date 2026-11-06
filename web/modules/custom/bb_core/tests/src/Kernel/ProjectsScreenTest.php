<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\views\Entity\View;
use Drupal\views\Plugin\views\area\AreaPluginBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * Groups and Projects are ordinary Views page displays, not a combined screen.
 *
 * Each listing owns its route. The named `%bb_workspace` placeholder is what
 * gives the slug converter, workspace access and front-end theme to both
 * pages. A controller that composed the two default displays would put both
 * tables on one URL and leave Groups without a destination of its own.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectsScreenTest extends KernelTestBase {

  use ProjectsViewTestTrait;

  /**
   * The two listing routes, keyed by view id.
   *
   * @var array<string, array{route: string, path: string, perm: string}>
   */
  private const LISTINGS = [
    'projects' => [
      'route' => 'view.projects.workspace_list',
      'path' => '/_workspace/{bb_workspace}/projects',
      'perm' => 'view bb_project',
    ],
    'groups' => [
      'route' => 'view.groups.workspace_list',
      'path' => '/_workspace/{bb_workspace}/groups',
      'perm' => 'view bb_group',
    ],
  ];

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installConfig(['system', 'user', 'views']);
    $this->installShippedView('views.view.projects');
    $this->installShippedView('views.view.groups');
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Both list base tables carry views data, with the fields the views read.
   */
  public function testListEntityTypesHaveViewsData(): void {
    $data = $this->container->get('views.views_data')->getAll();

    self::assertArrayHasKey('bb_project', $data, 'bb_project has no views data, so views.view.projects cannot be written.');
    self::assertArrayHasKey('bb_group', $data, 'bb_group has no views data, so views.view.groups cannot be written.');

    foreach (['name', 'key', 'group_id', 'owner_user_id'] as $field) {
      self::assertArrayHasKey($field, $data['bb_project'], "bb_project.$field is not in views data.");
    }
    foreach (['name', 'owner_user_id', 'workspace_id'] as $field) {
      self::assertArrayHasKey($field, $data['bb_group'], "bb_group.$field is not in views data.");
    }

    self::assertNotEmpty($data['bb_project']['table']['base'] ?? [], 'bb_project is not a Views base table.');
    self::assertNotEmpty($data['bb_group']['table']['base'] ?? [], 'bb_group is not a Views base table.');
  }

  /**
   * Each listing is a page display at its public workspace path.
   */
  public function testEachListingOwnsItsWorkspacePath(): void {
    $provider = $this->container->get('router.route_provider');
    foreach (self::LISTINGS as $view_id => $listing) {
      $route = $provider->getRouteByName($listing['route']);
      self::assertSame($listing['path'], $route->getPath());
      self::assertSame($view_id, $route->getDefault('view_id'));
      self::assertSame('workspace_list', $route->getDefault('display_id'));
      self::assertSame(
        ['arg_0' => 'bb_workspace'],
        $route->getOption('_view_argument_map'),
        $listing['route'] . ' must name the workspace slot so the slug reaches the view argument.',
      );
      $view = View::load($view_id);
      self::assertNotNull($view);
      self::assertSame(
        $listing['perm'],
        $view->getDisplay('default')['display_options']['access']['options']['perm'] ?? NULL,
      );
    }
  }

  /**
   * The workspace slot is converted and access-checked on both pages.
   */
  public function testWorkspaceSlotIsConvertedAndAccessChecked(): void {
    foreach (self::LISTINGS as $listing) {
      $route = $this->container->get('router.route_provider')
        ->getRouteByName($listing['route']);
      self::assertSame(
        'bb_core.paramconverter.workspace_slug',
        $route->getOption('parameters')['bb_workspace']['converter'] ?? NULL,
        $listing['route'] . ': an unconverted slot hands _bb_workspace_match a string.',
      );
      self::assertSame('TRUE', $route->getRequirement('_bb_workspace_match'), $listing['route']);
      self::assertFalse(
        (bool) $route->getOption('_admin_route'),
        $listing['route'] . ': an admin route would leave the product front end.',
      );
    }
  }

  /**
   * Each page is only its own view.
   */
  public function testEachPageIsOnlyItsOwnView(): void {
    foreach (self::LISTINGS as $view_id => $listing) {
      $route = $this->container->get('router.route_provider')
        ->getRouteByName($listing['route']);
      self::assertSame($view_id, $route->getDefault('view_id'));
      foreach (array_keys(self::LISTINGS) as $other) {
        if ($other === $view_id) {
          continue;
        }
        self::assertNotSame(
          $other,
          $route->getDefault('view_id'),
          $listing['route'] . " must not render view $other.",
        );
      }
    }
  }

  /**
   * Title search sits in Display Builder before the rows, then the pager.
   */
  public function testSearchToolbarSitsBeforeTheRows(): void {
    foreach (array_keys(self::LISTINGS) as $view_id) {
      $view = View::load($view_id);
      self::assertNotNull($view, "views.view.$view_id is not installed.");
      $display = $view->getDisplay('workspace_list');
      self::assertIsArray($display, "$view_id has no workspace_list display.");
      $options = $display['display_options'] ?? [];
      // Projects search name or key (combined fields); groups their name.
      $filter = $options['filters'][$view_id === 'projects' ? 'combine' : 'name'] ?? [];
      self::assertSame($view_id === 'projects' ? 'combine' : 'string', $filter['plugin_id'] ?? NULL, "$view_id search filter plugin.");
      if ($view_id === 'projects') {
        self::assertSame(['name' => 'name', 'key' => 'key'], $filter['fields'] ?? NULL, 'Projects search name and key.');
      }
      self::assertSame('contains', $filter['operator'] ?? NULL, "$view_id search filter must use contains.");
      self::assertTrue((bool) ($filter['exposed'] ?? FALSE), "$view_id search filter must be exposed.");
      self::assertSame('Search', $filter['expose']['label'] ?? NULL);
      self::assertSame('title', $filter['expose']['identifier'] ?? NULL);
      self::assertFalse((bool) ($filter['expose']['use_operator'] ?? FALSE), "$view_id must not expose the operator.");
      // NO SUBMIT BUTTON, and that is the assertion rather than the label the
      // no-JavaScript fallback still carries. The field submits itself, the way
      // the ticket list's own exposed form already does: `bef` with
      // `autosubmit` and `autosubmit_hide`, so a reader types and the list
      // narrows. A `basic` exposed form here would ship a visible `Search`
      // control beside a field that needs none.
      $exposed_form = $options['exposed_form'] ?? [];
      self::assertSame('bef', $exposed_form['type'] ?? NULL, "$view_id must autosubmit its title search.");
      $general = $exposed_form['options']['bef']['general'] ?? [];
      self::assertTrue((bool) ($general['autosubmit'] ?? FALSE), "$view_id must autosubmit.");
      self::assertTrue((bool) ($general['autosubmit_hide'] ?? FALSE), "$view_id must hide its submit button.");
      self::assertFalse((bool) ($general['autosubmit_exclude_textfield'] ?? TRUE), "$view_id must autosubmit its text field.");

      $ids = $this->listingContentSourceIds($view_id);
      // Status messages lead, then the search-and-sort toolbar before the
      // rows; the exposed form it binds to follows, holding only hidden parts.
      self::assertSame(
        ['block', 'component', 'view_rows', 'view_pager', 'view_exposed'],
        $ids,
        "$view_id must place the search toolbar before the rows.",
      );
    }
  }

  /**
   * No-match copy is the listing's own, and the combined controller is gone.
   */
  public function testTheCombinedControllerIsGone(): void {
    self::assertFalse(
      class_exists('Drupal\\bb_core\\Controller\\BbProjectsController'),
      'The combined projects controller is back; each view owns its page now.',
    );
    try {
      $this->container->get('router.route_provider')->getRouteByName('bb_core.projects');
      self::fail('bb_core.projects must not remain beside the Views page routes.');
    }
    catch (RouteNotFoundException) {
      // Expected: the controller route is gone.
    }

    foreach (['projects' => 'No projects found.', 'groups' => 'No groups found.'] as $id => $message) {
      $view = View::load($id)->getExecutable();
      $view->setDisplay('workspace_list');
      $view->setExposedInput(['title' => 'no-match']);
      $handlers = $view->display_handler->getHandlers('empty');
      self::assertCount(1, $handlers);
      $handler = reset($handlers);
      self::assertInstanceOf(AreaPluginBase::class, $handler);
      $build = $handler->render(TRUE);
      self::assertSame('bb_theme:empty-state', $build['#component']);
      self::assertSame($message, $build['#props']['message']);
      self::assertSame('inbox', $build['#props']['icon']);
      $handler->options['empty'] = FALSE;
      self::assertSame([], $handler->render(TRUE));
    }
  }

  /**
   * The listing zone's content sources, in order.
   *
   * @return array<int, string>
   *   source_id values.
   */
  private function listingContentSourceIds(string $view_id): array {
    $view = View::load($view_id);
    self::assertNotNull($view);
    $sources = $view->getDisplay('workspace_list')['display_options']['display_extenders']['display_builder']['sources'][0]['source']['component']['slots']['content']['sources'] ?? [];
    return array_values(array_column($sources, 'source_id'));
  }

}
