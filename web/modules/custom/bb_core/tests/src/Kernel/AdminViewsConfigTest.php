<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;

/**
 * The three admin listings under /admin/bakers are Views page displays.
 *
 * WHAT THIS ASSERTS. The shipped config: that each view exists, is enabled,
 * owns its collection path with a page display, and carries the columns and
 * exposed filters the acceptance criteria name. It asserts nothing about
 * whether a filter narrows anything — that is AdminViewsFilterTest, which
 * runs the views against real entities.
 *
 * WHY IT EXISTS AT ALL. Commit 549c738ac deleted all three of these views as
 * collateral of the bb_dashboard teardown, silently undoing BB-13,
 * BB-18, BB-73 and BB-208. Nothing failed, because nothing asserted
 * they were there. This class is that assertion.
 */
#[Group('bb_core')]
final class AdminViewsConfigTest extends KernelTestBase {

  use ProjectsViewTestTrait;

  /**
   * Per view: the page path, the field keys in order, the exposed filter ids.
   *
   * The filter ids are the EXPOSED identifiers a URL query string carries
   * (`?state=…`), not the filter keys in config — that is what an operator
   * and a bookmarked link actually use.
   *
   * @var array<string, array{path: string, fields: array<int, string>, exposed: array<int, string>}>
   */
  private const VIEWS = [
    'bb_tickets' => [
      'path' => 'admin/bakers/tickets',
      'fields' => [
        'identifier', 'title', 'project_id', 'workflow', 'state',
        'assignee_user_id', 'owner_user_id', 'conductor_id', 'changed', 'operations',
      ],
      'exposed' => [
        'identifier', 'title', 'workflow', 'assignee_user_id', 'state',
        'conductor_id', 'project_id',
      ],
    ],
    'bb_runs' => [
      'path' => 'admin/bakers/runs',
      'fields' => [
        'identifier', 'ticket_id', 'conductor_id', 'state', 'error_log_bytes',
        'started_at', 'tokens', 'duration_s', 'agent_turns', 'changed',
        'operations',
      ],
      'exposed' => ['identifier', 'title', 'state', 'conductor_id', 'user'],
    ],
    'bb_conductors' => [
      'path' => 'admin/bakers/conductors',
      'fields' => [
        'owner_user_id', 'label', 'status', 'active', 'utilization', 'last_seen',
        'project_id', 'operations',
      ],
      'exposed' => ['status'],
    ],
  ];

  /**
   * {@inheritdoc}
   *
   * The three views name better_exposed_filters, options, state_machine and
   * user in dependencies.module, and bb_core's own services pull og in —
   * bb_core.workspace_read_scope depends on og.membership_manager, so the
   * container will not build without it even though this class only reads
   * config.
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'file', 'image', 'options', 'text', 'filter', 'link',
    'entity', 'og', 'state_machine', 'views', 'better_exposed_filters',
    'views_autocomplete_filters', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_ticket');
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('bb_conductor');
    foreach (array_keys(self::VIEWS) as $id) {
      $this->installShippedView('views.view.' . $id);
    }
  }

  /**
   * Each view exists, is enabled, and owns its collection path.
   */
  public function testEachViewOwnsItsCollectionPath(): void {
    foreach (self::VIEWS as $id => $expected) {
      $view = View::load($id);
      self::assertNotNull($view, "views.view.$id is not installed.");
      self::assertTrue($view->status(), "views.view.$id is disabled.");

      $display = $view->getDisplay('page_1');
      self::assertNotNull($display, "views.view.$id has no page_1 display.");
      self::assertSame(
        'page',
        $display['display_plugin'],
        "views.view.$id page_1 is not a page display.",
      );
      self::assertSame(
        $expected['path'],
        $display['display_options']['path'],
        "views.view.$id does not own its collection path.",
      );
    }
  }

  /**
   * Each view shows the columns the acceptance criteria name, in order.
   */
  public function testEachViewShowsItsColumns(): void {
    foreach (self::VIEWS as $id => $expected) {
      $view = View::load($id);
      self::assertNotNull($view, "views.view.$id is not installed.");
      $fields = $view->getDisplay('default')['display_options']['fields'];
      self::assertSame(
        $expected['fields'],
        array_keys($fields),
        "views.view.$id does not carry its expected columns in order.",
      );
    }
  }

  /**
   * Each view exposes the filters the acceptance criteria name.
   */
  public function testEachViewExposesItsFilters(): void {
    foreach (self::VIEWS as $id => $expected) {
      $view = View::load($id);
      self::assertNotNull($view, "views.view.$id is not installed.");
      $filters = $view->getDisplay('default')['display_options']['filters'];

      $exposed = [];
      foreach ($filters as $filter) {
        if (($filter['exposed'] ?? FALSE) === TRUE) {
          $exposed[] = $filter['expose']['identifier'];
        }
      }
      sort($exposed);
      $wanted = $expected['exposed'];
      sort($wanted);
      self::assertSame(
        $wanted,
        $exposed,
        "views.view.$id does not expose its expected filters.",
      );
    }
  }

  /**
   * The ticket and run identifier filters are autocompletes.
   *
   * BB-73 delivered these, and views_autocomplete_filters is installed on
   * both paths (composer.json, core.extension.yml, recipes/bakers/recipe.yml),
   * so the setting is load-bearing rather than decorative.
   */
  public function testIdentifierFiltersAreAutocompletes(): void {
    foreach (['bb_tickets', 'bb_runs'] as $id) {
      $view = View::load($id);
      self::assertNotNull($view, "views.view.$id is not installed.");
      $filters = $view->getDisplay('default')['display_options']['filters'];
      self::assertSame(
        1,
        $filters['identifier']['expose']['autocomplete_filter'] ?? 0,
        "views.view.$id identifier filter is not an autocomplete.",
      );
    }
  }

  /**
   * No view carries a dependency on the deleted bb_dashboard module.
   *
   * This is the regression itself: that edge is what made Drupal delete two
   * of these three views on uninstall (549c738ac).
   */
  public function testNoViewDependsOnBbDashboard(): void {
    foreach (array_keys(self::VIEWS) as $id) {
      $view = View::load($id);
      self::assertNotNull($view, "views.view.$id is not installed.");
      self::assertNotContains(
        'bb_dashboard',
        $view->getDependencies()['module'] ?? [],
        "views.view.$id still depends on the deleted bb_dashboard module.",
      );
    }
  }

}
