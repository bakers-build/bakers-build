<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * A View of activities honours the workspace read scope.
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
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityViewReadScopeTest extends KernelTestBase {

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
    'bb_core', 'bb_activity',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_notification_setting');
    $this->installReadScopeEnvironment();
    $this->installEntitySchema('bb_activity');
    // installReadScopeEnvironment() creates the recipe-owned type/recipe/label
    // vocabularies the View's sample bb_ticket references (BB-339).
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * A test-local activity View returns only the member's ticket events.
   */
  public function testActivityViewIsTicketScoped(): void {
    $this->importFixtureView('bb_activities');
    $pm = $this->createScopedProjectManager();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_ticket')->set('state', 'plan')->save();
    }

    $ids = $this->executeViewAs('bb_activities', $pm);

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $expected = array_map('intval', array_values($storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $this->fixture('a', 'bb_ticket')->id())
      ->execute()));
    sort($expected);
    $foreign = array_map('intval', array_values($storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $this->fixture('b', 'bb_ticket')->id())
      ->execute()));
    self::assertSame($expected, $ids);
    self::assertNotSame([], $foreign);
    foreach ($foreign as $foreign_id) {
      self::assertNotContains($foreign_id, $ids);
    }
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
      . $this->container->get('extension.list.module')->getPath('bb_activity')
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
