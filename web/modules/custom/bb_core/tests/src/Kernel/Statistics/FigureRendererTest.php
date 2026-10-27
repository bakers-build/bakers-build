<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Statistics\FigureRenderer;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers how the atomic figure payload maps onto SDC render arrays.
 */
#[Group('bb_core')]
final class FigureRendererTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'file', 'image', 'options', 'bb_core'];

  /**
   * A `line` figure with several series renders through the comparison chart.
   */
  public function testLineFiguresRenderThroughTheComparisonChart(): void {
    $figure = [
      'id' => 'user_models_trend',
      'label' => 'Token spend by model',
      'description' => '',
      'widget' => 'line',
      'generated' => gmdate('c'),
      'filters' => [],
      'categories' => [
        ['key' => '2026-09-19', 'label' => 'Sat 19'],
        ['key' => '2026-09-20', 'label' => 'Sun 20', 'partial' => TRUE],
      ],
      'measurements' => [
        [
          'id' => 'run_tokens:claude-opus-5',
          'label' => 'claude-opus-5',
          'value_type' => 'integer',
          'unit' => 'tokens',
          'values' => ['2026-09-19' => 5, '2026-09-20' => 6],
        ],
        [
          'id' => 'run_tokens:grok-4.6',
          'label' => 'grok-4.6',
          'value_type' => 'integer',
          'unit' => 'tokens',
          'values' => ['2026-09-19' => 2, '2026-09-20' => 3],
        ],
        [
          'id' => 'run_tokens:other',
          'label' => 'Other',
          'value_type' => 'integer',
          'unit' => 'tokens',
          'values' => ['2026-09-19' => 1, '2026-09-20' => 1],
        ],
      ],
      'empty' => ['is_empty' => FALSE, 'message' => NULL],
      'cache' => ['max_age' => 0, 'contexts' => [], 'tags' => []],
    ];

    $widgets = $this->renderWidgets($figure);
    self::assertArrayHasKey('chart', $widgets);
    self::assertArrayNotHasKey('run_tokens:claude-opus-5', $widgets);
    self::assertSame('bb_theme:stat-comparison', $widgets['chart']['#component']);
    $chart = $widgets['chart']['#props']['chart'];
    self::assertSame('ready', $chart['state']);
    self::assertCount(3, $chart['series']);
    self::assertSame(
      ['run_tokens:claude-opus-5', 'run_tokens:grok-4.6', 'run_tokens:other'],
      array_column($chart['series'], 'key'),
    );
    // Each series gets its own style slot, which is what the theme turns into
    // its own `chart-series-*` colour.
    self::assertSame(['a', 'b', 'c'], array_column($chart['series'], 'style'));
    self::assertSame(['Sat 19', 'Sun 20'], $chart['labels']);
    // Points are {x, y} objects rather than bare numbers, so a gap is never a
    // null array element — the Storybook SDC addon crashes on one.
    self::assertSame(
      [['x' => 'Sat 19', 'y' => 5.0], ['x' => 'Sun 20', 'y' => 6.0]],
      $chart['series'][0]['values'],
    );
    self::assertSame('6', $chart['series'][0]['latest_value']);
    // The exact-value table is `rows`, never `entries`: Twing's json_encode
    // duck-types a Map by calling `thing.entries()`.
    self::assertArrayNotHasKey('entries', $chart);
    self::assertSame(
      [['date' => 'Sat 19', 'values' => ['5', '2', '1']], ['date' => 'Sun 20', 'values' => ['6', '3', '1']]],
      $chart['rows'],
    );
  }

  /**
   * A chart spans the full content width instead of sharing a two-column zone.
   *
   * Seven daily buckets is exactly the default period, and it used to satisfy
   * the `<= 7` rule that halved the plot.
   */
  public function testLineFiguresGetTheFullContentWidth(): void {
    $categories = [];
    foreach (range(14, 20) as $day) {
      $categories[] = ['key' => '2026-09-' . $day, 'label' => (string) $day];
    }
    $figure = $this->lineFigure($categories, [
      [
        'id' => 'closed_tickets:cw',
        'label' => 'cw',
        'value_type' => 'integer',
        'unit' => 'tickets',
        'values' => array_fill_keys(array_column($categories, 'key'), 1),
      ],
    ]);

    $build = $this->renderFigure($figure);
    self::assertSame(1, $build['#slots']['content']['#props']['columns']);
  }

  /**
   * The period switch belongs to the page, so no figure carries one.
   */
  public function testFigureActionsCarryNoFilterControls(): void {
    $figure = $this->lineFigure([['key' => '2026-09-20', 'label' => 'Sun 20']], []);
    $figure['filters'] = [
      'period' => [
        'label' => 'Period',
        'value' => '7',
        'options' => [
          ['value' => '7', 'label' => '7 days'],
          ['value' => '30', 'label' => '30 days'],
        ],
      ],
    ];

    $build = $this->renderFigure($figure);
    self::assertSame('', $build['#slots']['actions'] ?? '');
  }

  /**
   * An empty line figure still uses the comparison chart, not the breakdown.
   */
  public function testEmptyLineFiguresStayOnTheComparisonChart(): void {
    $figure = [
      'id' => 'user_models_trend',
      'label' => 'Token spend by model',
      'description' => '',
      'widget' => 'line',
      'generated' => gmdate('c'),
      'filters' => [],
      'categories' => [],
      'measurements' => [],
      'empty' => ['is_empty' => TRUE, 'message' => 'No data for this selection.'],
      'cache' => ['max_age' => 0, 'contexts' => [], 'tags' => []],
    ];

    $widgets = $this->renderWidgets($figure);
    self::assertArrayHasKey('chart', $widgets);
    self::assertArrayNotHasKey('breakdown', $widgets);
    self::assertSame('bb_theme:stat-comparison', $widgets['chart']['#component']);
    self::assertSame('empty', $widgets['chart']['#props']['chart']['state']);
  }

  /**
   * An empty figure that HAS categories carries no exact-value table.
   *
   * The categories exist whether or not anything was measured in them, so the
   * rows would otherwise be one line of dashes per date rendered beside the
   * figure's own empty widget.
   */
  public function testEmptyLineFiguresCarryNoExactValueRows(): void {
    $figure = $this->lineFigure(
      [
        ['key' => '2026-09-01', 'label' => '1 Sep'],
        ['key' => '2026-09-02', 'label' => '2 Sep'],
      ],
      [
        [
          'id' => 'closed_tickets',
          'label' => 'Closed tickets',
          'values' => [],
          'total' => NULL,
        ],
      ],
    );
    $figure['empty'] = ['is_empty' => TRUE, 'message' => 'No data for this selection.'];

    $chart = $this->renderWidgets($figure)['chart']['#props']['chart'];
    self::assertSame('empty', $chart['state']);
    self::assertSame([], $chart['rows']);
  }

  /**
   * The period buttons offer every kind but Custom, Week selected by default.
   */
  public function testPeriodButtonsOfferEveryKindButCustom(): void {
    $figure = $this->lineFigure([], []);
    $figure['filters'] = [
      'period' => [
        'label' => 'Period',
        'value' => 'week',
        'options' => [
          ['value' => 'week', 'label' => 'Week'],
          ['value' => 'month', 'label' => 'Month'],
          ['value' => 'quarter', 'label' => 'Quarter'],
          ['value' => 'year', 'label' => 'Year'],
          ['value' => 'all', 'label' => 'All time'],
          ['value' => 'custom', 'label' => 'Custom'],
        ],
      ],
    ];
    $renderer = $this->container->get('bb_core.figure_renderer');
    $buttons = (new \ReflectionMethod($renderer, 'filters'))->invoke($renderer, $figure)['period']['#slots']['content'];

    self::assertSame(['Week', 'Month', 'Quarter', 'Year', 'All time'], array_map(static fn(array $button): string => $button['#props']['label'], $buttons));
    self::assertSame('true', $buttons[0]['#props']['attributes']['aria-current']);
    self::assertArrayNotHasKey('aria-current', $buttons[1]['#props']['attributes']);
  }

  /**
   * A total figure renders one tile per measurement with its comparison.
   */
  public function testTotalFiguresRenderTilesWithComparison(): void {
    $tile = $this->renderWidgets($this->totalFigure(42, 37))['closed_tickets'];
    self::assertSame('bb_theme:stat-tile', $tile['#component']);
    self::assertSame('42', $tile['#props']['value']);
    self::assertSame('Closed tickets', $tile['#props']['label']);
    self::assertSame('Q4 2026', $tile['#props']['window']);
    self::assertSame(['value' => '37', 'label' => 'vs. Q3 2026', 'delta' => '+14 %', 'direction' => 'up'], $tile['#props']['comparison']);

    self::assertSame(['value' => '50', 'label' => 'vs. Q3 2026', 'delta' => '-16 %', 'direction' => 'down'], $this->renderWidgets($this->totalFigure(42, 50))['closed_tickets']['#props']['comparison']);
    self::assertSame(['value' => '0', 'label' => 'vs. Q3 2026', 'delta' => '—', 'direction' => 'flat'], $this->renderWidgets($this->totalFigure(42, 0))['closed_tickets']['#props']['comparison']);
    self::assertSame(['value' => '42', 'label' => 'vs. Q3 2026', 'delta' => '0 %', 'direction' => 'flat'], $this->renderWidgets($this->totalFigure(42, 42))['closed_tickets']['#props']['comparison']);
  }

  /**
   * All time has nothing to compare with, so the tile carries no comparison.
   */
  public function testAllTimeTotalCarriesNoComparison(): void {
    $figure = $this->totalFigure(42, NULL);
    $tile = $this->renderWidgets($figure)['closed_tickets'];
    self::assertSame('42', $tile['#props']['value']);
    self::assertArrayNotHasKey('comparison', $tile['#props']);
  }

  /**
   * Throughput shows closed tickets, the change in percent and the backlog.
   */
  public function testThroughputTileShowsClosedChangeAndBacklog(): void {
    $tile = $this->renderWidgets($this->overviewFigure(['closed_tickets' => [12, 10], 'created_tickets' => [15, 9]]))['closed_tickets'];
    self::assertSame('bb_theme:stat-tile', $tile['#component']);
    self::assertSame('kpi', $tile['#props']['size']);
    self::assertSame('Throughput', $tile['#props']['label']);
    self::assertSame('12', $tile['#props']['value']);
    self::assertSame('closed', $tile['#props']['unit']);
    self::assertSame(['value' => '10', 'label' => 'vs', 'delta' => '+20 %', 'direction' => 'up'], $tile['#props']['comparison']);
    self::assertSame('15 created · backlog +3', $tile['#props']['detail']);
    self::assertSame('Tickets closed in the period (done or cancelled), by their closed date (UTC).', $tile['#props']['info']);
  }

  /**
   * Runs per ticket shows the absolute change and the share needing many runs.
   */
  public function testRunsPerTicketTileShowsAbsoluteChangeAndManyRunsShare(): void {
    $tile = $this->renderWidgets($this->overviewFigure([
      'closed_tickets' => [12, 10],
      'runs' => [59, 56],
      'closed_tickets_many_runs' => [5, 4],
    ]))['runs_per_ticket'];
    self::assertSame('4.9', $tile['#props']['value']);
    self::assertSame(['value' => '5.6', 'label' => 'vs', 'delta' => '-0.7', 'direction' => 'down'], $tile['#props']['comparison']);
    self::assertSame('42 % needed > 3 runs', $tile['#props']['detail']);

    $small = $this->renderWidgets($this->overviewFigure(['closed_tickets' => [3, 10], 'runs' => [6, 56]]))['runs_per_ticket'];
    self::assertSame('—', $small['#props']['value']);
    self::assertSame('muted', $small['#props']['tone']);
    self::assertArrayNotHasKey('comparison', $small['#props']);
    self::assertSame('n = 3 closed tickets · needs 5', $small['#props']['detail']);
  }

  /**
   * Rating shows the mean of 5 and how many closed tickets were rated.
   */
  public function testRatingTileShowsMeanAndRatedOfClosed(): void {
    $tile = $this->renderWidgets($this->overviewFigure([
      'closed_tickets' => [12, 10],
      'job_rating' => [4.13, 3.9],
      'rated_tickets' => [6, 5],
    ]))['job_rating'];
    self::assertSame('4.1', $tile['#props']['value']);
    self::assertSame('of 5, job rating', $tile['#props']['unit']);
    self::assertSame(['value' => '3.9', 'label' => 'vs', 'delta' => '+0.2', 'direction' => 'up'], $tile['#props']['comparison']);
    self::assertSame('6 of 12 rated', $tile['#props']['detail']);

    $unrated = $this->renderWidgets($this->overviewFigure([
      'closed_tickets' => [12, 10],
      'job_rating' => [NULL, NULL],
      'rated_tickets' => [0, 0],
    ]))['job_rating'];
    self::assertSame('—', $unrated['#props']['value'], 'Nothing rated is never 0.');
  }

  /**
   * AI usage abbreviates the tokens and carries the exact value.
   */
  public function testAiUsageTileAbbreviatesAndCarriesExactValue(): void {
    $tile = $this->renderWidgets($this->overviewFigure([
      'closed_tickets' => [214, 198],
      'run_tokens' => [28412553104, 31200000000],
      'tokens_per_ticket' => [132768939.74, 157575757.58],
    ]))['run_tokens'];
    self::assertSame('28.4 B', $tile['#props']['value']);
    self::assertSame('tokens', $tile['#props']['unit']);
    self::assertSame('28,412,553,104 tokens — Sum of run tokens by run start, UTC', $tile['#props']['exact']);
    self::assertSame([
      'value' => '31.2 B',
      'label' => 'vs',
      'exact' => '31,200,000,000 tokens — Sum of run tokens by run start, UTC',
      'delta' => '-9 %',
      'direction' => 'down',
    ], $tile['#props']['comparison']);
    self::assertSame('≈ 133 M per closed ticket', $tile['#props']['detail']);
    self::assertSame('132,768,940 tokens per closed ticket — Run tokens ÷ closed tickets', $tile['#props']['detail_exact']);
  }

  /**
   * A bars figure renders each entry with its share of the whole.
   */
  public function testBarsFigureRendersShares(): void {
    $figure = $this->lineFigure(
      [['key' => 'opus', 'label' => 'Opus 5.5'], ['key' => 'unattributed', 'label' => 'Unattributed']],
      [$this->tokens(['opus' => 1890000000, 'unattributed' => 10000000])],
    );
    $figure['widget'] = 'bars';
    $figure['id'] = 'workspace_models';
    $figure['period'] = ['label' => 'Oct 2026'];
    $breakdown = $this->renderWidgets($figure)['breakdown'];
    self::assertSame('bars', $breakdown['#props']['display']);
    self::assertSame(['Opus 5.5', 'Unattributed'], array_column($breakdown['#props']['entries'], 'label'));
    self::assertSame(['1.9 B', '10.0 M'], array_column($breakdown['#props']['entries'], 'value'));
    self::assertSame([99.0, 1.0], array_column($breakdown['#props']['entries'], 'share'));
    self::assertSame(['99 %', '1 %'], array_column($breakdown['#props']['entries'], 'share_label'));
    self::assertSame([
      '1,890,000,000 tokens — Sum of run tokens by run start, UTC',
      '10,000,000 tokens — Sum of run tokens by run start, UTC',
    ], array_column($breakdown['#props']['entries'], 'exact'));
  }

  /**
   * Bars of a measurement other than tokens claim no token calculation.
   */
  public function testBarsOfOtherMeasurementsCarryNoTokenExactValue(): void {
    $figure = $this->lineFigure(
      [['key' => 'atlas', 'label' => 'atlas']],
      [
        [
          'id' => 'closed_tickets',
          'label' => 'Closed',
          'value_type' => 'integer',
          'unit' => 'tickets',
          'values' => ['atlas' => 1500],
        ],
      ],
    );
    $figure['widget'] = 'bars';
    $figure['id'] = 'workspace_models';
    $entries = $this->renderWidgets($figure)['breakdown']['#props']['entries'];
    self::assertArrayNotHasKey('exact', $entries[0]);
  }

  /**
   * Bars without any value leave only the figure's empty state.
   */
  public function testBarsWithoutValuesRenderNoRows(): void {
    $figure = $this->lineFigure([['key' => 'unattributed', 'label' => 'Unattributed']], [$this->tokens(['unattributed' => 0])]);
    $figure['widget'] = 'bars';
    $figure['id'] = 'workspace_models';
    self::assertArrayNotHasKey('breakdown', $this->renderWidgets($figure));
  }

  /**
   * Existing team figures keep their table breakdown and default tiles.
   */
  public function testExistingTeamStatsOutputIsUnchanged(): void {
    $figure = $this->lineFigure(
      [['key' => 'opus', 'label' => 'Opus']],
      [$this->tokens(['opus' => 5])],
    );
    $figure['widget'] = 'grouped_horizontal_bars';
    $breakdown = $this->renderWidgets($figure)['breakdown'];
    self::assertSame('bb_theme:stat-breakdown', $breakdown['#component']);
    self::assertArrayNotHasKey('display', $breakdown['#props']);
    self::assertSame([['label' => 'Opus', 'counts' => ['run_tokens' => '5']]], $breakdown['#props']['entries']);

    $tile = $this->renderWidgets($this->totalFigure(42, 37))['closed_tickets'];
    self::assertArrayNotHasKey('size', $tile['#props']);
  }

  /**
   * A run_tokens measurement payload.
   *
   * @param array<string, int> $values
   *   Values keyed by category.
   *
   * @return array<string, mixed>
   *   The measurement.
   */
  private function tokens(array $values): array {
    return [
      'id' => 'run_tokens',
      'label' => 'Token spend',
      'value_type' => 'integer',
      'unit' => 'tokens',
      'values' => $values,
    ];
  }

  /**
   * A workspace_overview-shaped tiles payload.
   *
   * @param array<string, array{0: int|float|null, 1: int|float|null}> $values
   *   Current and previous totals keyed by measurement id.
   *
   * @return array<string, mixed>
   *   The payload.
   */
  private function overviewFigure(array $values): array {
    $values += [
      'closed_tickets' => [10, 10],
      'created_tickets' => [10, 10],
      'runs' => [30, 30],
      'closed_tickets_many_runs' => [0, 0],
      'job_rating' => [4.0, 4.0],
      'rated_tickets' => [10, 10],
      'run_tokens' => [1000, 1000],
      'tokens_per_ticket' => [100.0, 100.0],
    ];
    $measurements = [];
    foreach ($values as $id => [$current, $previous]) {
      $measurements[] = [
        'id' => $id,
        'label' => $id,
        'value_type' => is_float($current) ? 'decimal' : 'integer',
        'unit' => '',
        'values' => ['total' => $current],
        'comparison' => ['values' => ['total' => $previous], 'labels' => ['total' => 'Sep 2026']],
      ];
    }
    $figure = $this->lineFigure([['key' => 'total', 'label' => 'Total']], $measurements);
    $figure['id'] = 'workspace_overview';
    $figure['widget'] = 'tiles';
    $figure['period'] = ['kind' => 'month', 'label' => 'Oct 2026', 'comparison' => ['label' => 'Sep 2026']];
    return $figure;
  }

  /**
   * Builds one `total` figure payload.
   *
   * @return array<string, mixed>
   *   One evaluated figure payload.
   */
  private function totalFigure(int $value, ?int $previous): array {
    $figure = $this->lineFigure([['key' => 'total', 'label' => 'Total']], [
      [
        'id' => 'closed_tickets',
        'label' => 'Closed tickets',
        'value_type' => 'integer',
        'unit' => 'tickets',
        'values' => ['total' => $value],
        'comparison' => $previous === NULL ? NULL : [
          'values' => ['total' => $previous],
          'labels' => ['total' => 'Q3 2026'],
        ],
      ],
    ]);
    $figure['widget'] = 'matrix';
    $figure['period'] = [
      'kind' => $previous === NULL ? 'all' : 'quarter',
      'start' => '2026-10-01',
      'end' => '2026-12-31',
      'label' => $previous === NULL ? 'All time' : 'Q4 2026',
      'grouping' => 'week',
      'current' => TRUE,
      'comparison' => $previous === NULL ? NULL : ['start' => '2026-07-01', 'end' => '2026-09-30', 'label' => 'Q3 2026'],
    ];
    return $figure;
  }

  /**
   * A `flow` figure maps new, done and open onto the flow chart's sections.
   */
  public function testFlowFigureRendersFlowChart(): void {
    $figure = $this->flowFigure(
      [
        ['key' => '2026-09-18', 'label' => 'Fri 18', 'cut' => TRUE],
        ['key' => '2026-09-19', 'label' => 'Sat 19'],
        ['key' => '2026-09-20', 'label' => 'Sun 20', 'partial' => TRUE],
      ],
      [3, 2, 1],
      [1, 2, 0],
      [5, 5, 6],
      0.8,
    );

    $build = $this->renderFigure($figure);
    // The chart carries its own heading; the figure adds none above it.
    self::assertSame('', $build['#slots']['heading']);
    $widgets = $this->renderWidgets($figure);
    self::assertSame('bb_theme:flow-chart', $widgets['chart']['#component']);
    self::assertSame([
      'state' => 'ready',
      'label' => 'New vs. done',
      'caption' => 'Per day, UTC · Sun 20 is still running',
      'ratio' => '0.8',
      'ratio_label' => 'done : new',
      'totals' => ['new' => '6', 'done' => '3'],
      'open_at' => '13:42 UTC',
      'sections' => [
        ['label' => 'Fri 18', 'new' => 3, 'done' => 1, 'open' => 5, 'running' => FALSE, 'cut' => TRUE],
        ['label' => 'Sat 19', 'new' => 2, 'done' => 2, 'open' => 5, 'running' => FALSE, 'cut' => FALSE],
        ['label' => 'Sun 20', 'new' => 1, 'done' => 0, 'open' => 6, 'running' => TRUE, 'cut' => FALSE],
      ],
    ], $widgets['chart']['#props']['chart']);
  }

  /**
   * Monthly sections without a running one carry no ratio and no open time.
   */
  public function testFlowFigureWithoutRatioPassesNull(): void {
    $figure = $this->flowFigure(
      [
        ['key' => '2026-07', 'label' => 'Jul 2026'],
        ['key' => '2026-08', 'label' => 'Aug 2026'],
      ],
      [0, 0],
      [1, 2],
      [4, 2],
      NULL,
    );

    $chart = $this->renderWidgets($figure)['chart']['#props']['chart'];
    self::assertNull($chart['ratio']);
    self::assertNull($chart['open_at']);
    self::assertSame('Per month, UTC', $chart['caption']);
  }

  /**
   * An empty flow figure keeps the flow chart in its empty state.
   */
  public function testEmptyFlowFigureUsesEmptyState(): void {
    $figure = $this->flowFigure([['key' => '2026-09-20', 'label' => 'Sun 20', 'partial' => TRUE]], [0], [0], [0], NULL);
    $figure['empty'] = ['is_empty' => TRUE, 'message' => 'No data for this selection.'];

    $widgets = $this->renderWidgets($figure);
    self::assertSame('bb_theme:flow-chart', $widgets['chart']['#component']);
    self::assertSame('empty', $widgets['chart']['#props']['chart']['state']);
  }

  /**
   * Builds one `flow` figure payload: new, done and open per category.
   *
   * @param array<int, array<string, mixed>> $categories
   *   The figure's categories.
   * @param array<int, int> $new
   *   New tickets per category.
   * @param array<int, int> $done
   *   Closed tickets per category.
   * @param array<int, int> $open
   *   Open tickets per category.
   * @param float|null $ratio
   *   The figure's done-to-new ratio.
   *
   * @return array<string, mixed>
   *   One evaluated figure payload.
   */
  private function flowFigure(array $categories, array $new, array $done, array $open, ?float $ratio): array {
    $keys = array_column($categories, 'key');
    $measurement = static fn(string $id, array $values, bool $total): array => [
      'id' => $id,
      'label' => $id,
      'value_type' => 'integer',
      'unit' => 'tickets',
      'values' => array_combine($keys, $values),
      'total' => $total ? array_sum($values) : NULL,
    ];
    return [
      'id' => 'flow',
      'label' => 'New vs. done',
      'description' => '',
      'widget' => 'flow',
      'generated' => '2026-09-20T13:42:00+00:00',
      'filters' => [],
      'categories' => $categories,
      'measurements' => [
        $measurement('created_tickets', $new, TRUE),
        $measurement('closed_tickets', $done, TRUE),
        $measurement('open_tickets', $open, FALSE),
      ],
      'ratio' => $ratio,
      'empty' => ['is_empty' => FALSE, 'message' => NULL],
      'cache' => ['max_age' => 0, 'contexts' => [], 'tags' => []],
    ];
  }

  /**
   * Builds one `line` figure payload around the supplied categories.
   *
   * @param array<int, array<string, mixed>> $categories
   *   The figure's categories.
   * @param array<int, array<string, mixed>> $measurements
   *   The figure's measurements.
   *
   * @return array<string, mixed>
   *   One evaluated figure payload.
   */
  private function lineFigure(array $categories, array $measurements): array {
    return [
      'id' => 'team_members_tickets_trend',
      'label' => 'Closed tickets by member over time',
      'description' => '',
      'widget' => 'line',
      'generated' => gmdate('c'),
      'filters' => [],
      'categories' => $categories,
      'measurements' => $measurements,
      'empty' => ['is_empty' => $measurements === [], 'message' => 'No data for this selection.'],
      'cache' => ['max_age' => 0, 'contexts' => [], 'tags' => []],
    ];
  }

  /**
   * Invokes the renderer's private figure build for one figure payload.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure payload.
   *
   * @return array<string, mixed>
   *   The figure render array.
   */
  private function renderFigure(array $figure): array {
    $renderer = $this->container->get('bb_core.figure_renderer');
    self::assertInstanceOf(FigureRenderer::class, $renderer);
    $method = new \ReflectionMethod($renderer, 'figure');
    return $method->invoke($renderer, $figure);
  }

  /**
   * Invokes the renderer's private widget mapping for one figure payload.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure payload.
   *
   * @return array<string, mixed>
   *   The mapped widget render arrays.
   */
  private function renderWidgets(array $figure): array {
    $renderer = $this->container->get('bb_core.figure_renderer');
    self::assertInstanceOf(FigureRenderer::class, $renderer);
    $method = new \ReflectionMethod($renderer, 'widget');
    return $method->invoke($renderer, $figure);
  }

}
