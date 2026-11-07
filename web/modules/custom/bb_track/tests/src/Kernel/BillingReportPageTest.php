<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Database\Database;
use Drupal\Core\Routing\RouteMatch;
use Drupal\Tests\bb_core\Kernel\Statistics\InsightsFixtureTrait;
use Drupal\bb_track\Controller\BillingReportController;
use Drupal\bb_track\Entity\Worklog;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Covers what the Billing report page assembles around the tree table.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class BillingReportPageTest extends WorkTimeTestBase {

  use InsightsFixtureTrait;

  private const ROUTE = 'bb_track.workspace.insights_billing';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['bb_conductor', 'bb_comment', 'bb_run', 'bb_term'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->container->get('router.builder')->rebuild();
    $this->installInsightsFigures();
  }

  /**
   * The page opens on this month, like Overview, and submits to itself.
   */
  public function testDefaultPeriodMatchesOverview(): void {
    $range = $this->components($this->page([]), 'bb_theme:period-range')[0]['#props'];
    self::assertSame('month', $range['kind']);
    self::assertSame('/week/insights/billing', $range['action']);
  }

  /**
   * The group switch reaches the table and keeps the period.
   */
  public function testGroupSwitchReachesTable(): void {
    $this->seed();
    $build = $this->page(['group' => 'person', 'filter' => ['period' => 'year']]);
    self::assertSame('Person / account / project / ticket', $this->components($build, 'bb_theme:table')[0]['#props']['columns'][0]['label']);
    $switch = $this->components($build, 'bb_theme:segmented_control')[0]['#props']['items'];
    self::assertSame([FALSE, TRUE], array_column($switch, 'active'));
    self::assertSame('/week/insights/billing?filter%5Bperiod%5D=year', $switch[0]['url']);
    self::assertSame([['name' => 'group', 'value' => 'person']], $this->components($build, 'bb_theme:period-range')[0]['#props']['params']);
  }

  /**
   * A project of another workspace in the filter is dropped, not an error.
   */
  public function testForeignFilterUuidIsDropped(): void {
    $this->seed();
    $storage = $this->container->get('entity_type.manager');
    $south = $storage->getStorage('bb_workspace')->create(['name' => 'South', 'slug' => 'south']);
    $south->save();
    $group = $storage->getStorage('bb_group')->create(['name' => 'South group', 'workspace_id' => $south->id()]);
    $group->save();
    $foreign = $storage->getStorage('bb_project')->create([
      'name' => 'South shop',
      'key' => 'SOUTH',
      'group_id' => $group->id(),
    ]);
    $foreign->save();
    $build = $this->page([
      'filter' => ['project' => [$foreign->uuid(), 'not-a-uuid'], 'account' => [['nested']]],
      'open' => ['x'],
      'sort' => ['billing' => 'drop table'],
    ]);
    self::assertCount(3, $this->components($build, 'bb_theme:stat-tile'));
    self::assertSame([], array_filter($this->components($build, 'bb_theme:button'), static fn(array $button): bool => $button['#props']['label'] === 'Clear filters'));
  }

  /**
   * The note explains the sources; the tiles total hours, accounts, tokens.
   */
  public function testNoteAndTilesShowTotals(): void {
    $this->seed();
    $build = $this->page([]);
    $note = $this->components($build, 'bb_theme:note')[0]['#slots']['body']['#plain_text'];
    self::assertStringContainsString('proposed time is excluded', $note);
    $tiles = array_column(array_column($this->components($build, 'bb_theme:stat-tile'), '#props'), NULL, 'label');
    self::assertSame(['3.0 h', '2.0 h approved · 1.0 h recorded'], [$tiles['Hours']['value'], $tiles['Hours']['detail']]);
    self::assertSame(['1', 'across 1 project'], [$tiles['Accounts']['value'], $tiles['Accounts']['detail']]);
    self::assertSame(['1.5 K', 'usage, not billed'], [$tiles['AI tokens']['value'], $tiles['AI tokens']['detail']]);
  }

  /**
   * Without hours or tokens the page explains itself instead of a table.
   */
  public function testEmptyStateWithoutHoursOrTokens(): void {
    $build = $this->page([]);
    self::assertNotEmpty($this->components($build, 'bb_theme:period-range'), 'The period stays selectable.');
    self::assertSame([], $this->components($build, 'bb_theme:table'));
    self::assertSame([], $this->components($build, 'bb_theme:stat-tile'));
    $headings = array_map(static fn(array $zone): string => (string) ($zone['#slots']['heading']['#plain_text'] ?? ''), $this->components($build, 'bb_theme:zone'));
    self::assertCount(1, preg_grep('/^No billable time or tokens in .+$/', $headings) ?: []);
  }

  /**
   * Filter ticks swap the report region and refresh the controls.
   */
  public function testFiltersApplyThroughHtmx(): void {
    $this->seed();
    $build = $this->page([]);
    $form = $build['controls']['#slots']['content']['filters'];
    self::assertSame('/week/insights/billing', $form['#attributes']['data-hx-get']);
    self::assertSame('#billing-report', $form['#attributes']['data-hx-target']);
    self::assertSame('billing-report', $build['content']['#attributes']['id']);
    $labels = array_map(static fn(array $picker): string => $picker['#props']['label'], $this->components($build, 'bb_theme:option_picker'));
    self::assertSame(['Account', 'Project'], $labels);
  }

  /**
   * Without entity filters the filter options reuse the one report build.
   */
  public function testUnfilteredPageBuildsTheReportOnce(): void {
    $this->seed();
    foreach ([[], ['group' => 'person']] as $query) {
      Database::startLog('report_builds');
      $build = $this->page($query);
      $log = Database::getLog('report_builds');
      Database::getConnection()->getLogger()?->clear('report_builds');
      $sums = array_filter($log, static fn(array $entry): bool => str_contains((string) $entry['query'], 'bb_track_worklog') && str_contains((string) $entry['query'], 'SUM('));
      self::assertCount(1, $sums, 'One hours aggregate per page.');
      $counts = array_map(static fn(array $picker): int => count($picker['#slots']['options']['#props']['options']), $this->components($build, 'bb_theme:option_picker'));
      self::assertSame([1, 1], $counts, 'Both pickers keep their options.');
    }
  }

  /**
   * Recorded 1 h, approved 2 h, proposed 4 h and 1,500 tokens today.
   */
  private function seed(): void {
    $today = gmdate('Y-m-d', $this->container->get('datetime.time')->getRequestTime());
    foreach (['recorded' => 3600, 'approved' => 7200, 'proposed' => 14400] as $state => $seconds) {
      $entry = Worklog::create([
        'owner_user_id' => $this->employee->id(),
        'work_date' => $today,
        'timezone' => 'UTC',
        'duration_seconds' => $seconds,
        'description' => 'Work',
        'derivation' => 'manual',
        'state' => $state,
        'project_id' => $this->project->id(),
      ]);
      assert($entry instanceof Worklog);
      LegacyWorklogFixture::save($entry);
    }
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Tokens',
      'project_id' => $this->project->id(),
      'workflow' => 'bb_work',
    ]);
    $ticket->save();
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'running',
      'state_at_start' => 'working',
      'created' => $this->container->get('datetime.time')->getRequestTime() - 60,
      'tokens' => 1500,
    ])->save();
  }

  /**
   * Renders the fixture workspace's report as its lead.
   *
   * @param array<string, mixed> $query
   *   The request query.
   *
   * @return array<string, mixed>
   *   The page render array.
   */
  private function page(array $query): array {
    $this->setCurrentUser($this->employee);
    $workspace = $this->fixtureWorkspace();
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ROUTE);
    $request = Request::create('/week/insights/billing', 'GET', $query);
    $request->setSession($this->container->get('request_stack')->getCurrentRequest()->getSession());
    $this->container->get('request_stack')->push($request);
    // The page body inside its canvas › zone frame.
    return BillingReportController::create($this->container)
      ->page(new RouteMatch(self::ROUTE, $route, ['bb_workspace' => $workspace], ['bb_workspace' => 'week']), $request)['#slots']['main']['#slots']['content'];
  }

  /**
   * Every component render array of one id, depth first.
   *
   * @param array<mixed> $build
   *   A render array.
   * @param string $id
   *   The component id.
   *
   * @return array<int, array<string, mixed>>
   *   The matching render arrays.
   */
  private function components(array $build, string $id): array {
    $found = ($build['#component'] ?? NULL) === $id ? [$build] : [];
    foreach ($build as $value) {
      if (is_array($value)) {
        array_push($found, ...$this->components($value, $id));
      }
    }
    return $found;
  }

}
