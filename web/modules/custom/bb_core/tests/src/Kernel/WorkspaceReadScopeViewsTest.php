<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * Views honour the read scope, and the traversal assumption is pinned (V6).
 *
 * Two halves, both about the same fact. `ViewsQueryAlter::mapConditions()`
 * explodes a condition field on the first `.` and treats part two as a property
 * name, and `DefaultTableMapping::getFieldColumnName()` then hands back the
 * field's own column — so `ticket_id.entity.project_id` becomes
 * `bb_run.ticket_id IN (<project ids>)`: wrong SQL, no exception, no dropped
 * condition. Single-level conditions map correctly, which is why the shipped
 * dashboard Views over bb_ticket and bb_conductor are safe and assertable.
 *
 * The second half asserts the assumption that makes the two traversals
 * acceptable — no shipped View is based on a traversing type for anyone but an
 * `administer bakers` holder — and it reads the traversing set from the
 * subscriber rather than naming two fields, so it keeps holding when BB-321
 * grows the ticket anchor (R2, D13).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeViewsTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'block',
    'ui_patterns', 'ui_patterns_views', 'ui_patterns_field_formatters',
    'better_exposed_filters', 'views_autocomplete_filters', 'display_builder',
    'display_builder_entity_view', 'display_builder_page_layout',
    'bb_core',
  ];

  /**
   * The permission a shipped View over a traversing type must be gated on.
   */
  private const ADMIN_PERMISSION = 'administer bakers';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    // ui_patterns builds a sample bb_ticket while resolving the View's row
    // plugin, and that sample references bb_term bundles; the recipe owns
    // them, and installReadScopeEnvironment() creates type/recipe/label.
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * The ticket dashboard View returns the member's workspace and no other.
   */
  public function testActiveTicketsViewIsWorkspaceScoped(): void {
    $this->importFixtureView('active_tickets');
    $pm = $this->createScopedProjectManager();

    $ids = $this->executeViewAs('active_tickets', $pm);

    self::assertSame(
      [(int) $this->fixture('a', 'bb_ticket')->id()],
      $ids,
      "The single-level project_id condition maps correctly in Views, so the "
      . 'dashboard shows the account its own workspace only.',
    );
  }

  /**
   * The conductor dashboard View returns the member's workspace and no other.
   *
   * MIGRATED by BB-378 from `nodes` to `bb_conductors`, not weakened: the
   * former was deleted with `bb_theme:node-row`, the component it rendered,
   * which is reachable from no Designbook scene. Both Views sit on the same
   * base table (`bb_conductor`) and ship from the same `config/install`, and
   * ::executeViewAs() runs the query without the access plugin, so the OG scope
   * this asserts is exercised exactly as before.
   */
  public function testConductorViewIsWorkspaceScoped(): void {
    $this->importFixtureView('bb_conductors');
    $pm = $this->createScopedProjectManager();

    $ids = $this->executeViewAs('bb_conductors', $pm);

    self::assertContains((int) $this->fixture('a', 'bb_conductor')->id(), $ids);
    self::assertNotContains((int) $this->fixture('b', 'bb_conductor')->id(), $ids);
  }

  /**
   * No shipped View is based on a traversing type for a non-admin role.
   *
   * The set of traversing types is derived from the rule map, so this assertion
   * cannot go stale: the day a rule adds a term the child types inherit it, and
   * the day a View appears over bb_run or bb_comment for anyone but an
   * `administer bakers` holder, Fact 7 stops being true and says so here rather
   * than serving wrong rows.
   */
  public function testNoShippedViewSitsOnTraversingTypesForNonAdmins(): void {
    $traversing = WorkspaceReadScopeSubscriber::traversingEntityTypeIds();
    self::assertNotSame([], $traversing, 'There are traversing rules to guard.');

    $base_tables = [];
    foreach ($traversing as $entity_type_id) {
      $definition = $this->container->get('entity_type.manager')
        ->getDefinition($entity_type_id);
      $base_tables[(string) $definition->getBaseTable()] = $entity_type_id;
    }

    $checked = 0;
    foreach ($this->shippedViewFiles() as $path) {
      $view = Yaml::parseFile($path);
      $base_table = $view['base_table'] ?? NULL;
      if (!is_string($base_table) || !isset($base_tables[$base_table])) {
        continue;
      }
      $checked++;
      foreach ($view['display'] ?? [] as $display_id => $display) {
        $access = $display['display_options']['access'] ?? NULL;
        if ($access === NULL) {
          // Inherits the default display's access, which is asserted with it.
          continue;
        }
        self::assertSame(
          self::ADMIN_PERMISSION,
          $access['options']['perm'] ?? NULL,
          sprintf(
            'A View over the traversing type %s must be gated on `%s`: its '
            . 'condition is mis-mapped by ViewsQueryAlter onto the wrong '
            . 'column. Offender: %s display %s.',
            $base_tables[$base_table],
            self::ADMIN_PERMISSION,
            basename($path),
            $display_id,
          ),
        );
      }
    }
    self::assertGreaterThan(
      0,
      $checked,
      'At least one shipped View sits on a traversing type, so the guard is '
      . 'measuring something. If this fails the file scan broke, not the rule.',
    );
  }

  /**
   * Returns every View config file this guard has to read.
   *
   * THREE globs, and the third is not an install path — which is the thing to
   * be careful about. bakers.build reaches a server through `config/sync` and a
   * fresh recipe install through the module's `config/install` and
   * `config/optional`, so a View that leaked into only one of them would be
   * missed by scanning either alone: both are scanned. The FIXTURES directory
   * is scanned in addition, because `bb_dashboard`'s Views were rehomed there
   * when BB-396 deleted the module, and the objects the rule was originally
   * written against still have to be measured somewhere.
   *
   * The distinction matters for what a failure means. A hit under
   * `config/{install,optional}` or `config/sync` is a SHIPPED View breaking the
   * rule; a hit under `tests/fixtures/` is a fixture that stopped representing
   * one. Dropping the module's own config directories — which is what this
   * method did for one commit, when it scanned `config/sync` plus the fixtures
   * and nothing else — leaves a View shipped only from `config/install` or
   * `config/optional` unguarded, while the non-vacuity assertion below still
   * passes because the other two globs keep it fed.
   *
   * @return array<string>
   *   Absolute paths.
   */
  private function shippedViewFiles(): array {
    $module_path = $this->root . '/' . $this->container->get('extension.list.module')
      ->getPath('bb_core');
    $globs = [
      dirname($this->root) . '/config/sync/views.view.*.yml',
      $module_path . '/config/install/views.view.*.yml',
      $module_path . '/config/optional/views.view.*.yml',
      // Not an install path — see above.
      $module_path . '/tests/fixtures/views/views.view.*.yml',
    ];
    $files = [];
    foreach ($globs as $glob) {
      $files = array_merge($files, glob($glob) ?: []);
    }
    self::assertNotSame([], $files, 'View files were found.');
    return $files;
  }

  /**
   * Imports one View fixture through the config factory.
   *
   * Written as raw config rather than through the View entity API on purpose:
   * saving a View runs calculateDependencies(), which asks the ui_patterns row
   * plugin for a sample bb_ticket, and generating one emits dozens of
   * warnings from contrib state_machine while phpunit.xml sets failOnWarning.
   * Only the query is under test, and ::execute() reaches it without that pass.
   *
   * @param string $view_id
   *   The View's config id.
   */
  private function importFixtureView(string $view_id): void {
    $path = $this->root . '/'
      . $this->container->get('extension.list.module')->getPath('bb_core')
      . '/tests/fixtures/views/views.view.' . $view_id . '.yml';
    self::assertFileExists($path);
    $values = Yaml::parseFile($path);
    unset($values['_core']);
    $values['uuid'] = $this->container->get('uuid')->generate();
    $this->config('views.view.' . $view_id)->setData($values)->save();
  }

  /**
   * Creates a project-manager-shaped account scoped to workspace A.
   *
   * @return \Drupal\user\UserInterface
   *   The account.
   */
  private function createScopedProjectManager(): UserInterface {
    $account = $this->createAccount('views-pm', [
      'access bakers dashboard', 'view bb_conductor', 'view bb_ticket',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which stops existing entirely once
    // BB-462 Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);
    return $account;
  }

  /**
   * Executes a View as the given account and returns the row entity ids.
   *
   * @param string $view_id
   *   The View to execute.
   * @param \Drupal\user\UserInterface $account
   *   The account to execute as.
   *
   * @return array<int>
   *   The ids of the returned rows, ascending.
   */
  private function executeViewAs(string $view_id, UserInterface $account): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      $view = Views::getView($view_id);
      self::assertNotNull($view, "The `$view_id` view exists.");
      $view->execute();
      $ids = [];
      foreach ($view->result as $row) {
        if ($row->_entity !== NULL) {
          $ids[] = (int) $row->_entity->id();
        }
        else {
          // Test-local Views may omit `_entity` and expose only the base id.
          // @phpstan-ignore property.notFound
          $ids[] = (int) $row->id;
        }
      }
    }
    finally {
      $switcher->switchBack();
    }
    sort($ids);
    return $ids;
  }

}
