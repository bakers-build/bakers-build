<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteMatch;
use Drupal\bb_core\Controller\BbStatsController;
use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbFigureGroup;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\Entity\Role;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Routing\Route;

/**
 * Covers the grouped, atomic statistics HTTP contract.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CompositeStatisticsResourceTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'serialization', 'file', 'image', 'jsonapi', 'jsonapi_resources', 'link', 'text',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $entityTypes = [
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_comment',
      'bb_run', 'bb_term',
    ];
    foreach ($entityTypes as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user', 'jsonapi']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->account('uid1-dummy');
    $this->container->get('router.builder')->rebuild();

    BbMeasurement::create([
      'id' => 'closed_tickets',
      'label' => 'Closed tickets',
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => ['entity_type' => 'bb_ticket', 'time_field' => 'closed_date'],
      'operation' => ['type' => 'count'],
      'predicates' => [['field' => 'closed', 'operator' => '=', 'value' => TRUE]],
      'bindings' => ['user' => ['field' => 'assignee_user_id', 'resolver' => 'entity_id']],
      'dimensions' => [
        'project' => ['field' => 'project_id', 'entity_type' => 'bb_project'],
      ],
    ])->save();
    BbFigure::create([
      'id' => 'user_activity',
      'label' => 'Activity',
      'description' => 'Closed tickets by day.',
      'widget' => 'line',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'days'],
      'filters' => [
        'period' => [
          'label' => 'Period',
          'default' => 'week',
          'options' => [
            ['value' => 'week', 'label' => 'Week'],
            ['value' => 'month', 'label' => 'Month'],
            ['value' => 'quarter', 'label' => 'Quarter'],
            ['value' => 'year', 'label' => 'Year'],
            ['value' => 'all', 'label' => 'All time'],
            ['value' => 'custom', 'label' => 'Custom'],
          ],
        ],
      ],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();
    BbFigure::create([
      'id' => 'user_projects',
      'label' => 'Projects',
      'description' => 'Closed tickets by project.',
      'widget' => 'grouped_horizontal_bars',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'dimension', 'dimension' => 'project'],
      'filters' => [
        'period' => [
          'label' => 'Period',
          'default' => 'week',
          'options' => [
            ['value' => 'week', 'label' => 'Week'],
            ['value' => 'month', 'label' => 'Month'],
            ['value' => 'quarter', 'label' => 'Quarter'],
            ['value' => 'year', 'label' => 'Year'],
            ['value' => 'all', 'label' => 'All time'],
            ['value' => 'custom', 'label' => 'Custom'],
          ],
        ],
      ],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();
    BbFigure::create([
      'id' => 'user_overview',
      'label' => 'Overview',
      'widget' => 'matrix',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'windows', 'values' => ['day', 'week', 'month']],
      'filters' => [],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();
    BbFigureGroup::create([
      'id' => 'empty',
      'label' => 'Empty',
      'weight' => -10,
      'figures' => [],
    ])->save();
    BbFigureGroup::create([
      'id' => 'activity',
      'label' => 'Activity',
      'weight' => 0,
      'figures' => ['user_overview', 'user_activity', 'user_projects'],
    ])->save();
  }

  /**
   * The collection includes atomic figures and omits empty groups.
   */
  public function testIndexReturnsOrderedNonEmptyGroupsWithAtomicFilteredFigures(): void {
    $account = $this->account('viewer');
    $response = $this->request('/jsonapi/bakers/statistics', $account, [
      'user_id' => $account->uuid(),
      'filter' => ['period' => '30'],
    ]);

    self::assertSame(200, $response->getStatusCode());
    $document = json_decode((string) $response->getContent(), TRUE);
    $groups = $document['data']['attributes']['groups'];
    self::assertSame(['activity'], array_column($groups, 'id'), 'Groups without disclosed figures are omitted.');
    self::assertSame('Activity', $groups[0]['label']);
    self::assertSame(['user_overview', 'user_activity', 'user_projects'], array_column($groups[0]['figures'], 'id'));
    self::assertSame([], $groups[0]['figures'][0]['filters'], 'A collection filter is applied only to figures that expose it.');
    $figure = $groups[0]['figures'][1];
    self::assertSame('user_activity', $figure['id']);
    self::assertSame('line', $figure['widget']);
    self::assertSame('week', $figure['filters']['period']['value'], 'An old preset falls back to the default kind.');
    self::assertSame('week', $figure['period']['kind']);
    self::assertCount(7, $figure['categories']);
    self::assertSame(['closed_tickets'], array_column($figure['measurements'], 'id'));
    self::assertStringNotContainsString('scope_id', (string) $response->getContent());
    self::assertStringContainsString('no-cache', $response->headers->get('Cache-Control', ''));
  }

  /**
   * A direct read resolves the anchor date and rejects only unknown keys.
   */
  public function testDirectReadResolvesThePeriodAndRejectsUnknownKeys(): void {
    $account = $this->account('period-viewer');
    $response = $this->request('/jsonapi/bakers/statistics/user_activity', $account, [
      'user_id' => $account->uuid(),
      'filter' => ['period' => 'month', 'date' => '2026-02-10'],
    ]);
    self::assertSame(200, $response->getStatusCode());
    $payload = json_decode((string) $response->getContent(), TRUE)['data']['attributes'];
    self::assertSame('month', $payload['filters']['period']['value']);
    self::assertSame(['start' => '2026-01-01', 'end' => '2026-01-31', 'label' => 'Jan 2026'], $payload['period']['comparison']);
    self::assertSame('2026-02-01', $payload['period']['start']);
    self::assertCount(28, $payload['categories']);
    self::assertCount(28, $payload['measurements'][0]['comparison']['values']);

    $legacy = $this->request('/jsonapi/bakers/statistics/user_activity', $account, [
      'user_id' => $account->uuid(),
      'filter' => ['period' => '30'],
    ]);
    self::assertSame(200, $legacy->getStatusCode());
    self::assertSame('week', json_decode((string) $legacy->getContent(), TRUE)['data']['attributes']['period']['kind']);

    $unknown = $this->request('/jsonapi/bakers/statistics/user_activity', $account, [
      'user_id' => $account->uuid(),
      'filter' => ['foo' => '1'],
    ]);
    self::assertSame(400, $unknown->getStatusCode());
  }

  /**
   * A filter entity of another workspace is a bad request, never a widening.
   */
  public function testForeignFilterEntityIsRejected(): void {
    BbFigure::create([
      'id' => 'workspace_closed',
      'label' => 'Closed',
      'widget' => 'matrix',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'total'],
      'filters' => ['project' => ['label' => 'Project', 'type' => 'entities', 'binding' => 'project']],
      'context_shape' => ['workspace'],
      'conditions' => [],
    ])->save();
    $storage = $this->container->get('entity_type.manager');
    $north = $storage->getStorage('bb_workspace')->create(['name' => 'north']);
    $north->save();
    $south = $storage->getStorage('bb_workspace')->create(['name' => 'south']);
    $south->save();
    $projects = [];
    foreach (['north' => $north, 'south' => $south] as $name => $workspace) {
      $group = $storage->getStorage('bb_group')->create(['name' => $name, 'workspace_id' => $workspace->id()]);
      $group->save();
      $projects[$name] = $storage->getStorage('bb_project')->create(['name' => $name, 'group_id' => $group->id()]);
      $projects[$name]->save();
    }
    $account = $this->account('workspace-reader', ['view bakers figure workspace_closed']);

    $own = $this->request('/jsonapi/bakers/statistics/workspace_closed', $account, [
      'workspace_id' => $north->uuid(),
      'filter' => ['project' => [$projects['north']->uuid()]],
    ]);
    self::assertSame(200, $own->getStatusCode());
    $foreign = $this->request('/jsonapi/bakers/statistics/workspace_closed', $account, [
      'workspace_id' => $north->uuid(),
      'filter' => ['project' => [$projects['south']->uuid()]],
    ]);
    self::assertSame(400, $foreign->getStatusCode());
    $scalarList = $this->request('/jsonapi/bakers/statistics/user_activity', $account, [
      'user_id' => $account->uuid(),
      'filter' => ['period' => ['week']],
    ]);
    self::assertSame(400, $scalarList->getStatusCode(), 'Only entity filters take a list.');
  }

  /**
   * Direct reads require the same named contexts and access as discovery.
   */
  public function testDirectReadUsesNamedContextAndRefusesAnotherUser(): void {
    $target = $this->account('target');
    $allowed = $this->request('/jsonapi/bakers/statistics/user_activity', $target, ['user_id' => $target->uuid()]);
    self::assertSame(200, $allowed->getStatusCode());
    $data = json_decode((string) $allowed->getContent(), TRUE)['data'];
    self::assertSame('user_activity', $data['id']);
    $payload = $data['attributes'];
    self::assertArrayHasKey('measurements', $payload);
    self::assertArrayHasKey('total', $payload['measurements'][0]);
    self::assertArrayHasKey('ratio', $payload);
    self::assertNull($payload['ratio']);

    $stranger = $this->account('stranger');
    $denied = $this->request(
      '/jsonapi/bakers/statistics/user_activity',
      $stranger,
      ['user_id' => $target->uuid()],
    );
    self::assertSame(403, $denied->getStatusCode());
    $legacy = $this->request(
      '/jsonapi/bakers/statistics',
      $target,
      ['scope_id' => $target->uuid()],
    );
    self::assertSame(400, $legacy->getStatusCode());
  }

  /**
   * A self user without the generated permission cannot read a figure.
   */
  public function testDirectReadRefusesSelfWithoutFigurePermission(): void {
    $account = $this->account('stranger');
    $denied = $this->request(
      '/jsonapi/bakers/statistics/user_activity',
      $account,
      ['user_id' => $account->uuid()],
    );

    self::assertSame(403, $denied->getStatusCode());
  }

  /**
   * The web controller renders labels and values from the shared payload.
   */
  public function testWebControllerRendersTheSharedPayloadFromNamedRouteContexts(): void {
    $account = $this->account('web-viewer');
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => 'Rendered project',
    ]);
    $project->save();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'Rendered ticket',
      'project_id' => $project->id(),
      'assignee_user_id' => $account->id(),
      'created' => $this->container->get('datetime.time')->getRequestTime(),
      'closed' => TRUE,
      'closed_date' => $this->container->get('datetime.time')->getRequestTime(),
    ])->save();
    $this->container->get('current_user')->setAccount($account);
    $route = new Route('/user/{target}', ['_bb_stats_contexts' => ['user' => 'target']]);
    $routeMatch = new RouteMatch('test.stats', $route, ['target' => $account]);
    $controller = BbStatsController::create($this->container);

    $request = Request::create(
      '/user/' . $account->id(),
      'GET',
      ['filter' => ['period' => '30']],
    );
    $build = $controller->stats($routeMatch, $request);
    $markup = (string) $this->container->get('renderer')->renderRoot($build);

    self::assertStringContainsString('data-bakers-tab-body="stats"', $markup);
    foreach (['stat-windows', 'stat-comparison', 'stat-breakdown', 'zone', 'button'] as $component) {
      self::assertStringContainsString('data-component-id="bb_theme:' . $component . '"', $markup);
    }
    self::assertStringContainsString('data-statistics-widget="line"', $markup);
    self::assertStringContainsString('data-statistics-widget="matrix"', $markup);
    self::assertStringContainsString('data-statistics-widget="grouped_horizontal_bars"', $markup);
    self::assertStringNotContainsString('background-color:', $markup);
    // The comparison chart is a Chart.js island: the server ships a canvas and
    // the model, never a drawn plot. A `<path>` here would mean the deleted
    // server-side chart renderer came back.
    self::assertStringContainsString('<canvas', $markup);
    self::assertStringContainsString('data-stat-comparison=', $markup);
    self::assertStringNotContainsString('<path', $markup);
    self::assertStringContainsString('Rendered project', $markup);
    self::assertStringContainsString('Closed tickets', $markup);
    foreach (['week', 'month', 'quarter', 'year', 'all'] as $kind) {
      self::assertStringContainsString('data-filter-value="' . $kind . '"', $markup);
    }
    self::assertStringNotContainsString('data-filter-value="custom"', $markup, 'Buttons cannot supply custom dates.');
    self::assertStringContainsString('aria-current="true"', $markup);
  }

  /**
   * Exact daily/monthly closed-ticket counts, boundary attribution.
   *
   * The single `period` filter's three fixed presets (7/30/365) now carry
   * BOTH the period bound and the implied granularity in one value — the
   * FigureEvaluator mapping.
   * Uses the shipped `*_tickets_trend` figure naming: a
   * single-measurement grouped_horizontal_bars figure, one of three trend
   * tabs (tickets/runs/tokens), with bar length scaled against a shared
   * maximum across the visible period rather than each row's own 100%.
   */
  public function testTicketsTrendCountsExactDailyAndMonthlyBucketsAtBoundaries(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $project = $entityTypeManager->getStorage('bb_project')->create(['name' => 'Boundary project']);
    $project->save();
    $time = $this->container->get('datetime.time')->getRequestTime();
    $today = (int) gmmktime(0, 0, 0, (int) gmdate('n', $time), (int) gmdate('j', $time), (int) gmdate('Y', $time));

    BbFigure::create([
      'id' => 'user_tickets_trend',
      'label' => 'Tickets trend',
      'widget' => 'grouped_horizontal_bars',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'days'],
      'filters' => [
        'period' => [
          'label' => 'Period',
          'default' => 'week',
          'options' => [
            ['value' => 'week', 'label' => 'Week'],
            ['value' => 'month', 'label' => 'Month'],
            ['value' => 'quarter', 'label' => 'Quarter'],
            ['value' => 'year', 'label' => 'Year'],
            ['value' => 'all', 'label' => 'All time'],
            ['value' => 'custom', 'label' => 'Custom'],
          ],
        ],
      ],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();
    BbFigureGroup::create([
      'id' => 'trend-group',
      'label' => 'Trend',
      'weight' => 0,
      'figures' => ['user_tickets_trend'],
    ])->save();

    // The permission is granted only now that the figure it names exists —
    // Role::calculateDependencies() strips any "view bakers figure <id>"
    // permission whose figure the dynamic FigurePermissions provider cannot
    // yet see, silently dropping it instead of erroring.
    $account = $this->account('boundary-viewer', ['view bakers figure user_tickets_trend']);
    // One ticket closes exactly at today's UTC midnight (the START of the
    // current-day bucket): it must land in exactly that one bucket, not the
    // previous day's.
    $entityTypeManager->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'Boundary ticket',
      'project_id' => $project->id(),
      'assignee_user_id' => $account->id(),
      'created' => $today,
      'closed' => TRUE,
      'closed_date' => $today,
    ])->save();

    $daily = $this->request('/jsonapi/bakers/statistics/user_tickets_trend', $account, [
      'user_id' => $account->uuid(),
      'filter' => [
        'period' => 'custom',
        'start' => gmdate('Y-m-d', $today - 6 * 86400),
        'end' => gmdate('Y-m-d', $today),
      ],
    ]);
    self::assertSame(200, $daily->getStatusCode());
    $dailyPayload = json_decode((string) $daily->getContent(), TRUE)['data']['attributes'];
    $todayKey = gmdate('Y-m-d', $today);
    self::assertSame(1, $dailyPayload['measurements'][0]['values'][$todayKey], 'The boundary ticket lands in exactly its own day bucket.');
    $yesterdayKey = gmdate('Y-m-d', $today - 86400);
    self::assertSame(0, $dailyPayload['measurements'][0]['values'][$yesterdayKey], 'The prior day bucket stays zero, not unavailable.');
    self::assertNotNull($dailyPayload['measurements'][0]['values'][$yesterdayKey], 'An empty period is zero, distinguishable from NULL/unavailable.');
    self::assertTrue((bool) array_filter($dailyPayload['categories'], static fn(array $category): bool => ($category['partial'] ?? FALSE) === TRUE));

    // Switching period to `year` selects the month category TYPE
    // (FigureEvaluator::categoryDefinition) as well as the year-long bound,
    // not merely a different value of the same days-type axis.
    $monthly = $this->request('/jsonapi/bakers/statistics/user_tickets_trend', $account, [
      'user_id' => $account->uuid(),
      'filter' => ['period' => 'year'],
    ]);
    self::assertSame(200, $monthly->getStatusCode());
    $monthlyPayload = json_decode((string) $monthly->getContent(), TRUE)['data']['attributes'];
    self::assertCount(12, $monthlyPayload['categories'], 'The year yields its 12 calendar-month buckets.');
    $monthKey = gmdate('Y-m', $today);
    self::assertSame(1, $monthlyPayload['measurements'][0]['values'][$monthKey]);
  }

  /**
   * The `runs_per_ticket` value and its unavailability at zero closed tickets.
   *
   * The divide operation must not report zero for an undefined ratio; it
   * must report NULL instead.
   */
  public function testRunsPerTicketValueAndUnavailabilityAtZeroClosedTickets(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $project = $entityTypeManager->getStorage('bb_project')->create(['name' => 'Ratio project']);
    $project->save();
    $time = $this->container->get('datetime.time')->getRequestTime();

    BbMeasurement::create([
      'id' => 'runs',
      'label' => 'Runs',
      'value_type' => 'integer',
      'unit' => 'runs',
      'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
      'operation' => ['type' => 'count'],
      'bindings' => ['user' => ['field' => 'ticket_id.entity.assignee_user_id', 'resolver' => 'entity_id']],
      'dimensions' => [],
    ])->save();
    BbMeasurement::create([
      'id' => 'runs_per_ticket',
      'label' => 'Runs per closed ticket',
      'value_type' => 'decimal',
      'unit' => 'runs_per_ticket',
      'source' => [],
      'operation' => ['type' => 'divide', 'numerator' => 'runs', 'denominator' => 'closed_tickets'],
      'bindings' => [],
      'dimensions' => [],
    ])->save();
    BbFigure::create([
      'id' => 'user_overview_ratio',
      'label' => 'Overview',
      'widget' => 'matrix',
      'measurements' => ['runs_per_ticket'],
      // The full ['day', 'week', 'month'] triple, not just ['day']: that is
      // what FigureRenderer::isWindows() requires to route through windows()
      // — and therefore through the ratio-component detection this test
      // covers — rather than falling through to the generic breakdown table.
      'categories' => ['type' => 'windows', 'values' => ['day', 'week', 'month']],
      'filters' => [],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();

    // Granted only now that `user_overview_ratio` exists: see the note on
    // `testActivityMatrixCountsExactDailyAndMonthlyBucketsAtBoundaries`.
    $account = $this->account('ratio-viewer', ['view bakers figure user_overview_ratio']);
    $ticket = $entityTypeManager->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'Ratio ticket',
      'project_id' => $project->id(),
      'assignee_user_id' => $account->id(),
      'created' => $time,
      'closed' => TRUE,
      'closed_date' => $time,
    ]);
    $ticket->save();
    for ($index = 0; $index < 3; $index++) {
      $entityTypeManager->getStorage('bb_run')->create([
        'ticket_id' => $ticket->id(),
        'created' => $time,
        'state' => 'done',
      ])->save();
    }

    $response = $this->request('/jsonapi/bakers/statistics/user_overview_ratio', $account, ['user_id' => $account->uuid()]);
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $payload = json_decode((string) $response->getContent(), TRUE)['data']['attributes'];
    self::assertSame(3, $payload['measurements'][0]['values']['day']);

    // FigureRenderer::windows() must key the ratio component off the unit
    // that is actually shipped, 'runs_per_ticket' — not the retired
    // 'tickets_per_run' the ratio was replaced by. That mismatch left
    // bb_theme:stat-ratio unreachable from every overview. Render through
    // the same grouped page path the browser hits, which needs the figure in
    // a figure group — `user_overview_ratio` is otherwise only reachable by
    // its own JSON:API path, as above.
    BbFigureGroup::create([
      'id' => 'ratio_check',
      'label' => 'Ratio check',
      'weight' => 0,
      'figures' => ['user_overview_ratio'],
    ])->save();
    $this->container->get('current_user')->setAccount($account);
    $route = new Route('/user/{target}', ['_bb_stats_contexts' => ['user' => 'target']]);
    $routeMatch = new RouteMatch('test.stats', $route, ['target' => $account]);
    $controller = BbStatsController::create($this->container);
    $request = Request::create('/user/' . $account->id(), 'GET');
    $build = $controller->stats($routeMatch, $request);
    $markup = (string) $this->container->get('renderer')->renderRoot($build);
    self::assertStringContainsString('data-component-id="bb_theme:stat-ratio"', $markup);
    self::assertStringContainsString('Runs per closed ticket', $markup);

    // A second account has runs but zero closed tickets in the window: the
    // ratio is unavailable (NULL), not a misleading zero.
    $barren = $this->account('barren-viewer', ['view bakers figure user_overview_ratio']);
    $barrenTicket = $entityTypeManager->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'Open ticket',
      'project_id' => $project->id(),
      'assignee_user_id' => $barren->id(),
      'created' => $time,
      'closed' => FALSE,
    ]);
    $barrenTicket->save();
    $entityTypeManager->getStorage('bb_run')->create([
      'ticket_id' => $barrenTicket->id(),
      'created' => $time,
      'state' => 'done',
    ])->save();
    $barrenResponse = $this->request('/jsonapi/bakers/statistics/user_overview_ratio', $barren, ['user_id' => $barren->uuid()]);
    self::assertSame(200, $barrenResponse->getStatusCode());
    $barrenPayload = json_decode((string) $barrenResponse->getContent(), TRUE)['data']['attributes'];
    self::assertNull($barrenPayload['measurements'][0]['values']['day'], 'Zero closed tickets makes the ratio unavailable, not zero.');
  }

  /**
   * A billion-scale token total survives serialization intact.
   *
   * No float precision loss, no truncation, and an unattributed model entry
   * is present in a dimensioned breakdown.
   */
  public function testBillionScaleTokenTotalAndUnattributedModelEntry(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $project = $entityTypeManager->getStorage('bb_project')->create(['name' => 'Token project']);
    $project->save();
    $time = $this->container->get('datetime.time')->getRequestTime();

    BbMeasurement::create([
      'id' => 'run_tokens',
      'label' => 'Token spend',
      'value_type' => 'integer',
      'unit' => 'tokens',
      'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
      'operation' => ['type' => 'sum', 'field' => 'tokens'],
      'bindings' => ['user' => ['field' => 'ticket_id.entity.assignee_user_id', 'resolver' => 'entity_id']],
      'dimensions' => ['model' => ['field' => 'model']],
    ])->save();
    BbFigure::create([
      'id' => 'user_tokens_trend',
      'label' => 'Tokens trend',
      'widget' => 'grouped_horizontal_bars',
      'measurements' => ['run_tokens'],
      'categories' => ['type' => 'windows', 'values' => ['month']],
      'filters' => [],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();
    BbFigure::create([
      'id' => 'user_models',
      'label' => 'Token spend by model',
      'widget' => 'grouped_horizontal_bars',
      'measurements' => ['run_tokens'],
      'categories' => ['type' => 'dimension', 'dimension' => 'model'],
      'filters' => [
        'period' => [
          'label' => 'Period',
          'default' => 'week',
          'options' => [
            ['value' => 'week', 'label' => 'Week'],
            ['value' => 'month', 'label' => 'Month'],
            ['value' => 'quarter', 'label' => 'Quarter'],
            ['value' => 'year', 'label' => 'Year'],
            ['value' => 'all', 'label' => 'All time'],
            ['value' => 'custom', 'label' => 'Custom'],
          ],
        ],
      ],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();

    // Granted only now that both figures exist — see the note on
    // `testActivityMatrixCountsExactDailyAndMonthlyBucketsAtBoundaries`.
    $account = $this->account('token-viewer', ['view bakers figure user_tokens_trend', 'view bakers figure user_models']);
    $ticket = $entityTypeManager->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'Token ticket',
      'project_id' => $project->id(),
      'assignee_user_id' => $account->id(),
      'created' => $time,
      'closed' => FALSE,
    ]);
    $ticket->save();
    $entityTypeManager->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'created' => $time,
      'state' => 'done',
      'tokens' => 844000000,
      'model' => 'claude-opus',
    ])->save();
    $entityTypeManager->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'created' => $time,
      'state' => 'done',
      'tokens' => 156000000,
      'model' => '',
    ])->save();

    $matrix = $this->request('/jsonapi/bakers/statistics/user_tokens_trend', $account, ['user_id' => $account->uuid()]);
    self::assertSame(200, $matrix->getStatusCode());
    $matrixPayload = json_decode((string) $matrix->getContent(), TRUE)['data']['attributes'];
    self::assertSame(1000000000, $matrixPayload['measurements'][0]['values']['month'], 'The billion-scale sum stays intact through the payload.');

    $models = $this->request('/jsonapi/bakers/statistics/user_models', $account, ['user_id' => $account->uuid()]);
    self::assertSame(200, $models->getStatusCode());
    $modelsPayload = json_decode((string) $models->getContent(), TRUE)['data']['attributes'];
    $rows = array_combine(
      array_column($modelsPayload['categories'], 'key'),
      $modelsPayload['measurements'][0]['values'],
    );
    self::assertArrayHasKey('unattributed', $rows, 'A run with no resolved model becomes the Unattributed row.');
    self::assertSame(156000000, $rows['unattributed']);
    self::assertSame(844000000, $rows['claude-opus']);
  }

  /**
   * Disclosure/workspace isolation across user, team and project scopes.
   *
   * A project figure is invisible outside its exact context shape, and a
   * stranger with no permission is refused even for a plain user-scoped
   * figure.
   */
  public function testDisclosureIsolatesFiguresAcrossUserTeamAndProjectScopes(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $project = $entityTypeManager->getStorage('bb_project')->create(['name' => 'Isolated project']);
    $project->save();

    BbFigure::create([
      'id' => 'project_scoped',
      'label' => 'Project scoped',
      'widget' => 'matrix',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'windows', 'values' => ['day']],
      'filters' => [],
      'context_shape' => ['project'],
      'conditions' => [
        'project' => [
          'id' => 'bb_route_context',
          'entity_type' => 'bb_project',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'project'],
        ],
      ],
    ])->save();

    $account = $this->account('scope-viewer', ['view bakers figure project_scoped']);
    // The figure names ['project'] as its exact context shape; a user-only
    // request must not disclose it even with an otherwise-valid session and
    // the exact permission — the shape mismatch alone refuses it (403, the
    // same as any other non-disclosure; only the legacy `scope_id` param
    // shape produces 400).
    $wrongShape = $this->request('/jsonapi/bakers/statistics/project_scoped', $account, ['user_id' => $account->uuid()]);
    self::assertSame(403, $wrongShape->getStatusCode());

    // The right shape, with the permission, is disclosed.
    $rightShape = $this->request('/jsonapi/bakers/statistics/project_scoped', $account, ['project_id' => $project->uuid()]);
    self::assertSame(200, $rightShape->getStatusCode());

    // A stranger with no permission at all is refused outright, even with
    // the right shape.
    $stranger = $this->account('stranger');
    $noPermission = $this->request('/jsonapi/bakers/statistics/project_scoped', $stranger, ['project_id' => $project->uuid()]);
    self::assertSame(403, $noPermission->getStatusCode());
  }

  /**
   * Issues one statistics HTTP request.
   *
   * @param string $path
   *   Request path.
   * @param \Drupal\user\UserInterface $account
   *   Requesting account.
   * @param array<string, mixed> $query
   *   Query parameters.
   *
   * @return \Symfony\Component\HttpFoundation\Response
   *   The response.
   */
  private function request(string $path, UserInterface $account, array $query): Response {
    $this->container->get('current_user')->setAccount($account);
    $request = Request::create($path, 'GET', $query);
    $request->headers->set('Accept', 'application/vnd.api+json');
    return $this->container->get('http_kernel')->handle($request, HttpKernelInterface::SUB_REQUEST);
  }

  /**
   * Creates an active account.
   *
   * @param string $name
   *   The account name.
   * @param array<string> $extraPermissions
   *   Additional `view bakers figure <id>` permissions to grant, beyond the
   *   three figures the base fixture set discloses.
   */
  private function account(string $name, array $extraPermissions = []): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $account);
    if ($name !== 'stranger' && $name !== 'uid1-dummy') {
      $roleId = 'statistics_' . str_replace('-', '_', $name);
      Role::create([
        'id' => $roleId,
        'label' => $name,
        'permissions' => array_merge([
          'view bakers figure user_activity',
          'view bakers figure user_overview',
          'view bakers figure user_projects',
        ], $extraPermissions),
      ])->save();
      $account->addRole($roleId);
    }
    $account->save();
    return $account;
  }

}
