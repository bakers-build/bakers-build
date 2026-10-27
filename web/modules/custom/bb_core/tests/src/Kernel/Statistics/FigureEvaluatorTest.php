<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementResult;
use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers atomic category-by-measurement figure payloads.
 */
#[Group('bb_core')]
final class FigureEvaluatorTest extends KernelTestBase {

  private const NOW = 1789920000;

  /**
   * The calendar period filter every period figure ships with.
   */
  private const PERIOD_FILTER = [
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
  ];

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'bb_core'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      ['closed_tickets', 'Closed tickets', 'integer', 'tickets'],
      ['runs', 'Runs', 'integer', 'runs'],
      ['tickets_per_run', 'Tickets per run', 'decimal', 'tickets_per_run'],
    ] as [$id, $label, $valueType, $unit]) {
      BbMeasurement::create([
        'id' => $id,
        'label' => $label,
        'value_type' => $valueType,
        'unit' => $unit,
        'source' => ['entity_type' => 'bb_ticket', 'time_field' => 'closed_date'],
        'operation' => ['type' => 'count'],
        'predicates' => [],
        'bindings' => [],
        'dimensions' => [],
      ])->save();
    }
    BbMeasurement::create([
      'id' => 'run_tokens',
      'label' => 'Run tokens',
      'value_type' => 'integer',
      'unit' => 'tokens',
      'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
      'operation' => ['type' => 'sum', 'field' => 'tokens'],
      'predicates' => [],
      'bindings' => [],
      'dimensions' => ['model' => ['field' => 'model']],
    ])->save();
    BbMeasurement::create([
      'id' => 'open_tickets',
      'label' => 'Open tickets',
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => ['entity_type' => 'bb_ticket', 'time_field' => 'created'],
      'operation' => ['type' => 'open', 'end_field' => 'closed_date'],
      'predicates' => [],
      'bindings' => [],
      'dimensions' => [],
    ])->save();
  }

  /**
   * Totals sum every section, the running one included; open has none.
   */
  public function testTotalsSumAllSectionsIncludingRunning(): void {
    $categories = $this->flowDays();
    $payload = $this->evaluator([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets', $categories,
        ['d1' => 2, 'd2' => 3, 'd3' => 0, 'today' => 1],
      ),
      'open_tickets' => $this->measurementResult(
        'open_tickets', 'Open tickets', 'integer', 'tickets', $categories,
        ['d1' => 4, 'd2' => 5, 'd3' => 5, 'today' => 6],
      ),
    ])->evaluate(
      $this->figure('flow', 'Flow', 'line', ['type' => 'days'], ['closed_tickets', 'open_tickets']),
      [],
      [],
      self::NOW,
    )->toArray();

    self::assertSame(6, $payload['measurements'][0]['total']);
    self::assertNull($payload['measurements'][1]['total']);
    self::assertNull($payload['ratio']);
  }

  /**
   * Overlapping windows and derived quotients have no meaningful total.
   */
  public function testTotalIsNullForWindowsAndDerivedMeasurements(): void {
    BbMeasurement::create([
      'id' => 'closed_per_run',
      'label' => 'Closed per run',
      'value_type' => 'decimal',
      'unit' => 'tickets_per_run',
      'source' => [],
      'operation' => ['type' => 'divide', 'numerator' => 'closed_tickets', 'denominator' => 'runs'],
      'predicates' => [],
      'bindings' => [],
      'dimensions' => [],
    ])->save();
    $windows = $this->evaluator([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets',
        $this->windows(), ['day' => 2, 'week' => 6, 'month' => 12],
      ),
    ])->evaluate($this->figure('windows', 'Windows', 'matrix', [
      'type' => 'windows',
      'values' => ['day', 'week', 'month'],
    ], ['closed_tickets']), [], [], self::NOW)->toArray();
    self::assertNull($windows['measurements'][0]['total']);

    $categories = $this->flowDays();
    $derived = $this->evaluator([
      'closed_per_run' => $this->measurementResult(
        'closed_per_run', 'Closed per run', 'decimal', 'tickets_per_run', $categories,
        ['d1' => 1.5, 'd2' => 2.0, 'd3' => 0.5, 'today' => NULL],
      ),
    ])->evaluate($this->figure('derived', 'Derived', 'line', ['type' => 'days'], ['closed_per_run']), [], [], self::NOW)->toArray();
    self::assertNull($derived['measurements'][0]['total']);
  }

  /**
   * The ratio is done over new on complete sections only.
   */
  public function testRatioIgnoresRunningAndCutSections(): void {
    $categories = $this->flowDays();
    $payload = $this->evaluator([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets', $categories,
        ['d1' => 2, 'd2' => 2, 'd3' => 5, 'today' => 0],
      ),
      'runs' => $this->measurementResult(
        'runs', 'Runs', 'integer', 'runs', $categories,
        ['d1' => 2, 'd2' => 3, 'd3' => 9, 'today' => 3],
      ),
    ])->evaluate($this->ratioFigure(), [], [], self::NOW)->toArray();

    self::assertSame(0.8, $payload['ratio']);
    self::assertSame(9, $payload['measurements'][0]['total']);
  }

  /**
   * No new tickets in a complete section leaves the ratio without a number.
   */
  public function testRatioIsNullWithoutNewTickets(): void {
    $categories = $this->flowDays();
    $payload = $this->evaluator([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets', $categories,
        ['d1' => 2, 'd2' => 2, 'd3' => 0, 'today' => 0],
      ),
      'runs' => $this->measurementResult(
        'runs', 'Runs', 'integer', 'runs', $categories,
        ['d1' => 0, 'd2' => 0, 'd3' => 4, 'today' => 3],
      ),
    ])->evaluate($this->ratioFigure(), [], [], self::NOW)->toArray();
    self::assertNull($payload['ratio']);

    $running = [['key' => 'today', 'label' => 'Sun 20', 'partial' => TRUE]];
    $payload = $this->evaluator([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets', $running,
        ['today' => 1],
      ),
      'runs' => $this->measurementResult('runs', 'Runs', 'integer', 'runs', $running, ['today' => 1]),
    ])->evaluate($this->ratioFigure(), [], [], self::NOW)->toArray();
    self::assertNull($payload['ratio']);
  }

  /**
   * A matrix serializes ordered categories and all measurement values together.
   */
  public function testMatrixPayloadIsAtomic(): void {
    $evaluator = $this->evaluator([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets',
        $this->windows(), ['day' => 2, 'week' => 6, 'month' => 12],
      ),
      'runs' => $this->measurementResult(
        'runs', 'Runs', 'integer', 'runs',
        $this->windows(), ['day' => 1, 'week' => 3, 'month' => 4],
      ),
      'tickets_per_run' => $this->measurementResult(
        'tickets_per_run', 'Tickets per run', 'decimal', 'tickets_per_run',
        $this->windows(), ['day' => 2.0, 'week' => 2.0, 'month' => 3.0],
      ),
    ]);
    $payload = $evaluator->evaluate($this->figure('overview', 'Overview', 'matrix', [
      'type' => 'windows',
      'values' => ['day', 'week', 'month'],
    ]), [], [], self::NOW)->toArray();

    self::assertSame('matrix', $payload['widget']);
    self::assertSame(['day', 'week', 'month'], array_column($payload['categories'], 'key'));
    self::assertSame(['closed_tickets', 'runs', 'tickets_per_run'], array_column($payload['measurements'], 'id'));
    self::assertSame(['day' => 1, 'week' => 3, 'month' => 4], $payload['measurements'][1]['values']);
    self::assertSame('tickets_per_run', $payload['measurements'][2]['unit']);
    self::assertFalse($payload['empty']['is_empty']);
    self::assertSame(0, $payload['cache']['max_age']);
    self::assertContains('user.permissions', $payload['cache']['contexts']);
    self::assertContains('config:bb_core.bb_figure.overview', $payload['cache']['tags']);
  }

  /**
   * The selected period sets the range, grouping and comparison range.
   */
  public function testSelectedPeriodSetsRangeAndGrouping(): void {
    $categories = [
      ['key' => '2026-W45', 'label' => 'W45'],
    ];
    $measurementEvaluator = $this->fake([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets',
        $categories, ['2026-W45' => 1],
      ),
    ]);
    $evaluator = $this->evaluatorFrom($measurementEvaluator);
    $figure = $this->figure('activity', 'Activity', 'line', ['type' => 'days'], ['closed_tickets'], self::PERIOD_FILTER);

    $payload = $evaluator->evaluate($figure, [], ['period' => 'quarter', 'date' => '2026-11-05'], self::NOW)->toArray();

    self::assertSame('quarter', $payload['filters']['period']['value']);
    self::assertSame([
      'kind' => 'quarter',
      'start' => '2026-10-01',
      'end' => '2026-12-31',
      'label' => 'Q4 2026',
      'grouping' => 'week',
      'current' => FALSE,
      'comparison' => ['start' => '2026-07-01', 'end' => '2026-09-30', 'label' => 'Q3 2026'],
    ], $payload['period']);
    self::assertSame(
      ['type' => 'weeks', 'from' => self::at(2026, 10, 1), 'to' => self::at(2026, 12, 31) + 86399],
      $measurementEvaluator->categoryDefinitions[0],
    );
    self::assertSame(self::at(2026, 7, 1), $measurementEvaluator->categoryDefinitions[1]['from']);
    self::assertSame('weeks', $measurementEvaluator->categoryDefinitions[1]['type']);
  }

  /**
   * An old preset or an unusable value falls back to the default kind.
   */
  public function testUnsupportedPeriodFallsBackToTheDefault(): void {
    $figure = $this->figure('activity', 'Activity', 'line', ['type' => 'days'], ['closed_tickets'], self::PERIOD_FILTER);
    $evaluator = $this->evaluator(['closed_tickets' => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', [], [])]);

    foreach ([['period' => '365'], ['period' => '14'], ['period' => 'custom', 'start' => '2026-09-10']] as $selected) {
      $payload = $evaluator->evaluate($figure, [], $selected, self::NOW)->toArray();
      self::assertSame('week', $payload['filters']['period']['value']);
      self::assertSame('week', $payload['period']['kind']);
      self::assertSame('2026-09-14', $payload['period']['start']);
      self::assertTrue($payload['period']['current']);
    }
  }

  /**
   * All time starts at the earliest record and has no comparison.
   */
  public function testAllTimeUsesTheEarliestRecord(): void {
    $september = [['key' => '2026-09', 'label' => 'Sep 2026']];
    $measurementEvaluator = $this->fake([
      'closed_tickets' => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $september, ['2026-09' => 1]),
      'runs' => $this->measurementResult('runs', 'Runs', 'integer', 'runs', $september, ['2026-09' => 2]),
    ], ['closed_tickets' => self::at(2026, 3, 2, 9), 'runs' => self::at(2025, 12, 30, 9)]);
    $evaluator = $this->evaluatorFrom($measurementEvaluator);
    $figure = $this->figure('activity', 'Activity', 'line', ['type' => 'days'], ['closed_tickets', 'runs'], self::PERIOD_FILTER);

    $payload = $evaluator->evaluate($figure, [], ['period' => 'all'], self::NOW)->toArray();

    self::assertSame('2025-12-30', $payload['period']['start']);
    self::assertSame('month', $payload['period']['grouping']);
    self::assertNull($payload['period']['comparison']);
    self::assertNull($payload['measurements'][0]['comparison']);
    self::assertCount(2, $measurementEvaluator->categoryDefinitions, 'All time evaluates no comparison period.');
  }

  /**
   * A dimension keeps its type and is bounded by the period.
   */
  public function testDimensionKeepsItsTypeAndGetsTheRange(): void {
    $measurementEvaluator = $this->fake(['closed_tickets' => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', [], [])]);
    $categories = ['type' => 'dimension', 'dimension' => 'project'];
    $figure = $this->figure('projects', 'Projects', 'grouped_horizontal_bars', $categories, ['closed_tickets'], self::PERIOD_FILTER);

    $this->evaluatorFrom($measurementEvaluator)->evaluate($figure, [], ['period' => 'month', 'date' => '2026-02-10'], self::NOW);

    self::assertSame(
      [
        'type' => 'dimension',
        'dimension' => 'project',
        'from' => self::at(2026, 2, 1),
        'to' => self::at(2026, 2, 28) + 86399,
      ],
      $measurementEvaluator->categoryDefinitions[0],
    );
  }

  /**
   * Time buckets of the comparison period align by position.
   */
  public function testComparisonAlignsTimeBucketsByPosition(): void {
    $current = self::weekCategories(40, 53);
    $previous = self::weekCategories(27, 40);
    $evaluator = $this->evaluatorFrom($this->fakeByRange([
      self::at(2026, 10, 1) => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $current, array_fill_keys(array_column($current, 'key'), 1)),
      self::at(2026, 7, 1) => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $previous, array_combine(array_column($previous, 'key'), range(1, 14))),
    ]));
    $figure = $this->figure('activity', 'Activity', 'line', ['type' => 'days'], ['closed_tickets'], self::PERIOD_FILTER);

    $payload = $evaluator->evaluate($figure, [], ['period' => 'quarter', 'date' => '2026-11-05'], self::NOW)->toArray();

    $comparison = $payload['measurements'][0]['comparison'];
    self::assertSame(array_column($current, 'key'), array_keys($comparison['values']));
    self::assertSame(1, $comparison['values']['2026-W40']);
    self::assertSame('W27', $comparison['labels']['2026-W40']);
    self::assertSame(14, $comparison['values']['2026-W53']);
    self::assertSame('W40', $comparison['labels']['2026-W53']);
  }

  /**
   * A shorter comparison period leaves the trailing positions empty.
   */
  public function testShorterComparisonLeavesTrailingPositionsNull(): void {
    $march = self::dayCategories(2026, 3, 31);
    $february = self::dayCategories(2026, 2, 28);
    $evaluator = $this->evaluatorFrom($this->fakeByRange([
      self::at(2026, 3, 1) => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $march, array_fill_keys(array_column($march, 'key'), 2)),
      self::at(2026, 2, 1) => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $february, array_fill_keys(array_column($february, 'key'), 1)),
    ]));
    $figure = $this->figure('activity', 'Activity', 'line', ['type' => 'days'], ['closed_tickets'], self::PERIOD_FILTER);

    $comparison = $evaluator->evaluate($figure, [], ['period' => 'month', 'date' => '2026-03-15'], self::NOW)->toArray()['measurements'][0]['comparison'];

    self::assertCount(31, $comparison['values']);
    self::assertSame(1, $comparison['values']['2026-03-28']);
    self::assertSame('Sat 28', $comparison['labels']['2026-03-28']);
    foreach (['2026-03-29', '2026-03-30', '2026-03-31'] as $key) {
      self::assertNull($comparison['values'][$key]);
      self::assertNull($comparison['labels'][$key]);
    }
  }

  /**
   * Dimension rows align by key; the current rows decide.
   */
  public function testComparisonAlignsDimensionRowsByKey(): void {
    $alpha = ['key' => 'alpha', 'label' => 'Alpha'];
    $beta = ['key' => 'beta', 'label' => 'Beta'];
    $gamma = ['key' => 'gamma', 'label' => 'Gamma'];
    $evaluator = $this->evaluatorFrom($this->fakeByRange([
      self::at(2026, 9, 1) => [
        'closed_tickets' => $this->measurementResult(
          'closed_tickets', 'Closed tickets', 'integer', 'tickets', [$alpha, $beta], ['alpha' => 3, 'beta' => 2],
        ),
        'tickets_per_run' => $this->measurementResult(
          'tickets_per_run', 'Tickets per run', 'decimal', 'tickets_per_run', [$alpha], ['alpha' => 1.5],
        ),
      ],
      self::at(2026, 8, 1) => [
        'closed_tickets' => $this->measurementResult(
          'closed_tickets', 'Closed tickets', 'integer', 'tickets', [$beta, $gamma], ['beta' => 5, 'gamma' => 7],
        ),
        'tickets_per_run' => $this->measurementResult(
          'tickets_per_run', 'Tickets per run', 'decimal', 'tickets_per_run', [$gamma], ['gamma' => 2.0],
        ),
      ],
    ]));
    $categories = ['type' => 'dimension', 'dimension' => 'project'];
    $measurements = ['closed_tickets', 'tickets_per_run'];
    $figure = $this->figure('projects', 'Projects', 'grouped_horizontal_bars', $categories, $measurements, self::PERIOD_FILTER);

    $payload = $evaluator->evaluate($figure, [], ['period' => 'month', 'date' => '2026-09-10'], self::NOW)->toArray();

    self::assertSame(['alpha' => 0, 'beta' => 5], $payload['measurements'][0]['comparison']['values']);
    self::assertSame(['alpha' => 'Aug 2026', 'beta' => 'Aug 2026'], $payload['measurements'][0]['comparison']['labels']);
    self::assertSame(['alpha' => NULL, 'beta' => NULL], $payload['measurements'][1]['comparison']['values']);
  }

  /**
   * The current top series decide; Other sums every other comparison group.
   */
  public function testSeriesComparisonFollowsTheCurrentSeries(): void {
    $categories = [['key' => '2026-09-14', 'label' => 'Mon 14']];
    $previous = [['key' => '2026-09-07', 'label' => 'Mon 7']];
    $measurementEvaluator = $this->fakeSeriesByRange([
      self::at(2026, 9, 14) => [
        $this->measurementResult('run_tokens:alice', 'alice', 'integer', 'tokens', $categories, ['2026-09-14' => 5]),
        $this->measurementResult('run_tokens:_other', 'Other', 'integer', 'tokens', $categories, ['2026-09-14' => 2]),
      ],
      self::at(2026, 9, 7) => [
        $this->measurementResult('run_tokens:bob', 'bob', 'integer', 'tokens', $previous, ['2026-09-07' => 9]),
        $this->measurementResult('run_tokens:alice', 'alice', 'integer', 'tokens', $previous, ['2026-09-07' => 4]),
        $this->measurementResult('run_tokens:carol', 'carol', 'integer', 'tokens', $previous, ['2026-09-07' => 1]),
      ],
    ]);
    $figure = $this->figureWithSeries('user_models_trend', 'days', 'model', 1, ['run_tokens']);
    $figure->set('filters', self::PERIOD_FILTER);

    $payload = $this->evaluatorFrom($measurementEvaluator)->evaluate($figure, [], [], self::NOW)->toArray();

    self::assertSame(['2026-09-14' => 4], $payload['measurements'][0]['comparison']['values']);
    self::assertSame(['2026-09-14' => 10], $payload['measurements'][1]['comparison']['values']);
    self::assertSame([1, PHP_INT_MAX], $measurementEvaluator->limits);
  }

  /**
   * A total figure is one bucket labelled with the comparison period.
   */
  public function testTotalComparisonCarriesThePeriodLabel(): void {
    $total = [['key' => 'total', 'label' => 'Total']];
    $evaluator = $this->evaluatorFrom($this->fakeByRange([
      self::at(2026, 10, 1) => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $total, ['total' => 42]),
      self::at(2026, 7, 1) => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $total, ['total' => 37]),
    ]));
    $figure = $this->figure('closed_total', 'Closed', 'matrix', ['type' => 'total'], ['closed_tickets'], self::PERIOD_FILTER);

    $payload = $evaluator->evaluate($figure, [], ['period' => 'quarter', 'date' => '2026-11-05'], self::NOW)->toArray();

    self::assertSame($total, $payload['categories']);
    self::assertSame(['values' => ['total' => 37], 'labels' => ['total' => 'Q3 2026']], $payload['measurements'][0]['comparison']);
    self::assertSame($payload['period']['comparison']['label'], $payload['measurements'][0]['comparison']['labels']['total']);
  }

  /**
   * Rolling-window figures carry neither a period nor a comparison.
   */
  public function testWindowsCarryNoPeriodOrComparison(): void {
    $values = ['day' => 1, 'week' => 2, 'month' => 3];
    $evaluator = $this->evaluator([
      'closed_tickets' => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', $this->windows(), $values),
    ]);
    $payload = $evaluator->evaluate($this->figure('overview', 'Overview', 'matrix', [
      'type' => 'windows',
      'values' => ['day', 'week', 'month'],
    ], ['closed_tickets']), [], [], self::NOW)->toArray();

    self::assertArrayNotHasKey('period', $payload);
    self::assertArrayNotHasKey('comparison', $payload['measurements'][0]);
  }

  /**
   * Entity categories are unioned and absent count values become zero.
   */
  public function testGroupedBarsAlignDifferentMeasurementCategories(): void {
    $evaluator = $this->evaluator([
      'closed_tickets' => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', [
        ['key' => 'alpha', 'label' => 'Alpha'],
      ], ['alpha' => 3]),
      'runs' => $this->measurementResult('runs', 'Runs', 'integer', 'runs', [
        ['key' => 'beta', 'label' => 'Beta'],
      ], ['beta' => 2]),
    ]);

    $payload = $evaluator->evaluate($this->figure(
      'projects',
      'Projects',
      'grouped_horizontal_bars',
      ['type' => 'dimension', 'dimension' => 'project'],
      ['closed_tickets', 'runs'],
    ), [], [], self::NOW)->toArray();

    self::assertSame(['alpha', 'beta'], array_column($payload['categories'], 'key'));
    self::assertSame(['alpha' => 3, 'beta' => 0], $payload['measurements'][0]['values']);
    self::assertSame(['alpha' => 0, 'beta' => 2], $payload['measurements'][1]['values']);
  }

  /**
   * Unknown filter keys are rejected; the period companions are not.
   */
  public function testFilterKeysAreValidated(): void {
    $figure = $this->figure('filtered', 'Filtered', 'line', ['type' => 'days'], ['closed_tickets'], self::PERIOD_FILTER);
    $evaluator = $this->evaluator(['closed_tickets' => $this->measurementResult('closed_tickets', 'Closed tickets', 'integer', 'tickets', [], [])]);

    $selected = ['period' => 'custom', 'start' => '2026-09-01', 'end' => '2026-09-10', 'date' => '2026-09-01'];
    $payload = $evaluator->evaluate($figure, [], $selected, self::NOW)->toArray();
    self::assertSame('custom', $payload['period']['kind']);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('Unknown filter');
    $evaluator->evaluate($figure, [], ['unknown' => '7'], self::NOW);
  }

  /**
   * All-zero and null values produce an explicit, stable empty state.
   */
  public function testEmptyStateKeepsTheFigureSchema(): void {
    $evaluator = $this->evaluator([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets',
        $this->windows(), ['day' => 0, 'week' => 0, 'month' => 0],
      ),
      'runs' => $this->measurementResult(
        'runs', 'Runs', 'integer', 'runs',
        $this->windows(), ['day' => 0, 'week' => 0, 'month' => 0],
      ),
      'tickets_per_run' => $this->measurementResult(
        'tickets_per_run', 'Tickets per run', 'decimal', 'tickets_per_run',
        $this->windows(), ['day' => NULL, 'week' => NULL, 'month' => NULL],
      ),
    ]);

    $payload = $evaluator->evaluate($this->figure('empty', 'Empty', 'matrix', [
      'type' => 'windows',
      'values' => ['day', 'week', 'month'],
    ]), [], [], self::NOW)->toArray();

    self::assertTrue($payload['empty']['is_empty']);
    self::assertSame('No data for this selection.', $payload['empty']['message']);
    self::assertCount(3, $payload['measurements']);
  }

  /**
   * A figure's series source expands one measurement into several series.
   */
  public function testSeriesExpandsIntoOneMeasurementPerSeries(): void {
    $categories = [
      ['key' => '2026-09-19', 'label' => 'Sat 19'],
      ['key' => '2026-09-20', 'label' => 'Sun 20', 'partial' => TRUE],
    ];
    $seriesResults = [
      $this->measurementResult(
        'run_tokens:big', 'big', 'integer', 'tokens',
        $categories, ['2026-09-19' => 5, '2026-09-20' => 6],
      ),
      $this->measurementResult(
        'run_tokens:other', 'Other', 'integer', 'tokens',
        $categories, ['2026-09-19' => 1, '2026-09-20' => 2],
      ),
    ];
    $measurementEvaluator = $this->fakeSeries($seriesResults);
    $evaluator = $this->evaluatorFrom($measurementEvaluator);
    $figure = $this->figureWithSeries('user_models_trend', 'days', 'model', 5, ['run_tokens']);

    $payload = $evaluator->evaluate($figure, [], [], self::NOW)->toArray();

    self::assertSame(['run_tokens:big', 'run_tokens:other'], array_column($payload['measurements'], 'id'));
    self::assertSame(['big', 'Other'], array_column($payload['measurements'], 'label'));
    self::assertContains('config:bb_core.bb_measurement.run_tokens', $payload['cache']['tags']);
  }

  /**
   * A series figure rejects a category type other than `days`/`months`.
   */
  public function testSeriesRejectsNonTimeCategory(): void {
    $figure = BbFigure::create([
      'id' => 'invalid_series',
      'label' => 'Invalid series',
      'widget' => 'line',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'windows', 'values' => ['day', 'week', 'month']],
      'series' => ['dimension' => 'user', 'limit' => 5],
      'context_shape' => [],
      'conditions' => [],
    ]);
    $evaluator = $this->evaluator([]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('time category');
    $evaluator->evaluate($figure, [], [], self::NOW);
  }

  /**
   * A series figure rejects a dimension its measurement never declared.
   */
  public function testSeriesRejectsAnUndeclaredDimension(): void {
    $figure = $this->figureWithSeries('bad_dimension', 'days', 'nonexistent', 5, ['closed_tickets']);
    $evaluator = $this->evaluator([]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('does not define dimension');
    $evaluator->evaluate($figure, [], [], self::NOW);
  }

  /**
   * Creates a figure evaluator with fixed measurement results.
   *
   * @param array<string, MeasurementResult> $results
   *   The results keyed by measurement ID.
   */
  private function evaluator(array $results): FigureEvaluator {
    return $this->evaluatorFrom($this->fake($results));
  }

  /**
   * Creates a figure evaluator with a supplied measurement evaluator.
   */
  private function evaluatorFrom(MeasurementEvaluatorInterface $measurementEvaluator): FigureEvaluator {
    return new FigureEvaluator(
      $this->container->get('entity_type.manager'),
      $measurementEvaluator,
      $this->container->get('bb_core.figure_filter_resolver'),
      new PeriodResolver(),
    );
  }

  /**
   * Creates a measurement evaluator that returns fixed results.
   *
   * @param array<string, MeasurementResult> $results
   *   The results keyed by measurement ID.
   * @param array<string, int> $earliest
   *   The earliest record timestamps keyed by measurement ID.
   *
   * @return \Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface&object{categoryDefinitions: array<int, array<string, mixed>>}
   *   The fake, exposing the category definitions it was asked for.
   */
  private function fake(array $results, array $earliest = []): MeasurementEvaluatorInterface {
    return new class($results, $earliest) implements MeasurementEvaluatorInterface {

      /** @var array<int, array<string, mixed>> */
      public array $categoryDefinitions = [];

      /**
       * Constructs the fake evaluator.
       *
       * @param array<string, MeasurementResult> $results
       *   The results keyed by measurement ID.
       * @param array<string, int> $earliest
       *   The earliest record timestamps keyed by measurement ID.
       */
      public function __construct(
        private readonly array $results,
        private readonly array $earliest,
      ) {}

      /**
       * {@inheritdoc}
       */
      public function earliest(BbMeasurementInterface $measurement, array $contexts, int $now): ?int {
        return $this->earliest[$measurement->id()] ?? NULL;
      }

      /**
       * {@inheritdoc}
       */
      public function evaluate(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, int $now): MeasurementResult {
        $this->categoryDefinitions[] = $categoryDefinition;
        if (!isset($this->results[$measurement->id()])) {
          throw new \RuntimeException('Unexpected measurement ' . $measurement->id());
        }
        return $this->results[$measurement->id()];
      }

      /**
       * {@inheritdoc}
       */
      public function evaluateSeries(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, string $dimensionKey, int $limit, int $now): array {
        throw new \RuntimeException('This fake returns single results only; use fakeSeries().');
      }

    };
  }

  /**
   * Creates a measurement evaluator that returns a fixed series list.
   *
   * @param array<int, MeasurementResult> $results
   *   The series results returned regardless of the requested dimension.
   */
  private function fakeSeries(array $results): MeasurementEvaluatorInterface {
    return new class($results) implements MeasurementEvaluatorInterface {

      /**
       * Constructs the fake series evaluator.
       *
       * @param array<int, MeasurementResult> $results
       *   The series results.
       */
      public function __construct(private readonly array $results) {}

      /**
       * {@inheritdoc}
       */
      public function earliest(BbMeasurementInterface $measurement, array $contexts, int $now): ?int {
        return NULL;
      }

      /**
       * {@inheritdoc}
       */
      public function evaluate(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, int $now): MeasurementResult {
        throw new \RuntimeException('This fake returns series only; use fake().');
      }

      /**
       * {@inheritdoc}
       */
      public function evaluateSeries(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, string $dimensionKey, int $limit, int $now): array {
        return $this->results;
      }

    };
  }

  /**
   * Creates a measurement evaluator whose results depend on the range start.
   *
   * @param array<int, MeasurementResult|array<string, MeasurementResult>> $results
   *   One result, or results keyed by measurement ID, keyed by `from`.
   */
  private function fakeByRange(array $results): MeasurementEvaluatorInterface {
    return new class($results) implements MeasurementEvaluatorInterface {

      /**
       * Constructs the fake evaluator.
       *
       * @param array<int, MeasurementResult|array<string, MeasurementResult>> $results
       *   The results keyed by range start.
       */
      public function __construct(private readonly array $results) {}

      /**
       * {@inheritdoc}
       */
      public function earliest(BbMeasurementInterface $measurement, array $contexts, int $now): ?int {
        return NULL;
      }

      /**
       * {@inheritdoc}
       */
      public function evaluate(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, int $now): MeasurementResult {
        $result = $this->results[$categoryDefinition['from']] ?? throw new \RuntimeException('Unexpected range ' . gmdate('Y-m-d', $categoryDefinition['from']));
        return $result instanceof MeasurementResult ? $result : $result[(string) $measurement->id()];
      }

      /**
       * {@inheritdoc}
       */
      public function evaluateSeries(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, string $dimensionKey, int $limit, int $now): array {
        throw new \RuntimeException('This fake returns single results only.');
      }

    };
  }

  /**
   * Creates a series evaluator whose results depend on the range start.
   *
   * @param array<int, array<int, MeasurementResult>> $results
   *   The series results keyed by `from`.
   *
   * @return \Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface&object{limits: array<int, int>}
   *   The fake, exposing the series limits it was asked for.
   */
  private function fakeSeriesByRange(array $results): MeasurementEvaluatorInterface {
    return new class($results) implements MeasurementEvaluatorInterface {

      /** @var array<int, int> */
      public array $limits = [];

      /**
       * Constructs the fake series evaluator.
       *
       * @param array<int, array<int, MeasurementResult>> $results
       *   The series results keyed by range start.
       */
      public function __construct(private readonly array $results) {}

      /**
       * {@inheritdoc}
       */
      public function earliest(BbMeasurementInterface $measurement, array $contexts, int $now): ?int {
        return NULL;
      }

      /**
       * {@inheritdoc}
       */
      public function evaluate(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, int $now): MeasurementResult {
        throw new \RuntimeException('This fake returns series only.');
      }

      /**
       * {@inheritdoc}
       */
      public function evaluateSeries(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, string $dimensionKey, int $limit, int $now): array {
        $this->limits[] = $limit;
        return $this->results[$categoryDefinition['from']] ?? throw new \RuntimeException('Unexpected range');
      }

    };
  }

  /**
   * ISO-week categories of 2026.
   *
   * @return array<int, array{key: string, label: string}>
   *   The categories.
   */
  private static function weekCategories(int $first, int $last): array {
    return array_map(
      static fn(int $week): array => ['key' => sprintf('2026-W%02d', $week), 'label' => sprintf('W%02d', $week)],
      range($first, $last),
    );
  }

  /**
   * Day categories of one month.
   *
   * @return array<int, array{key: string, label: string}>
   *   The categories.
   */
  private static function dayCategories(int $year, int $month, int $days): array {
    return array_map(static fn(int $day): array => [
      'key' => gmdate('Y-m-d', self::at($year, $month, $day)),
      'label' => gmdate('D j', self::at($year, $month, $day)),
    ], range(1, $days));
  }

  /**
   * A UTC timestamp.
   */
  private static function at(int $year, int $month, int $day, int $hour = 0): int {
    return (int) gmmktime($hour, 0, 0, $month, $day, $year);
  }

  /**
   * Creates an unsaved figure carrying a series source.
   */
  private function figureWithSeries(string $id, string $categoryType, string $dimension, int $limit, array $measurements): BbFigure {
    return BbFigure::create([
      'id' => $id,
      'label' => $id,
      'description' => '',
      'widget' => 'line',
      'measurements' => $measurements,
      'categories' => ['type' => $categoryType],
      'series' => ['dimension' => $dimension, 'limit' => $limit],
      'filters' => [],
      'context_shape' => [],
      'conditions' => [],
    ]);
  }

  /**
   * Creates an unsaved figure configuration.
   */
  private function figure(
    string $id,
    string $label,
    string $widget,
    array $categories,
    array $measurements = ['closed_tickets', 'runs', 'tickets_per_run'],
    array $filters = [],
  ): BbFigure {
    return BbFigure::create([
      'id' => $id,
      'label' => $label,
      'description' => $label . ' description',
      'widget' => $widget,
      'measurements' => $measurements,
      'categories' => $categories,
      'filters' => $filters,
      'context_shape' => [],
      'conditions' => [],
    ]);
  }

  /**
   * Creates an evaluated measurement result.
   *
   * @param string $id
   *   The measurement ID.
   * @param string $label
   *   The display label.
   * @param string $valueType
   *   The value type.
   * @param string $unit
   *   The display unit.
   * @param array<int, array{key: string, label: string, partial?: bool}> $categories
   *   The ordered categories.
   * @param array<string, int|float|null> $values
   *   The values keyed by category.
   */
  private function measurementResult(string $id, string $label, string $valueType, string $unit, array $categories, array $values): MeasurementResult {
    return new MeasurementResult($id, $label, $valueType, $unit, $categories, $values);
  }

  /**
   * Creates a done-over-new figure on closed tickets over runs.
   */
  private function ratioFigure(): BbFigure {
    $figure = $this->figure('flow', 'Flow', 'line', ['type' => 'days'], ['closed_tickets', 'runs']);
    $figure->set('ratio', ['numerator' => 'closed_tickets', 'denominator' => 'runs']);
    return $figure;
  }

  /**
   * Gets two complete days, a cut day and the running day.
   *
   * @return array<int, array{key: string, label: string, partial?: bool, cut?: bool}>
   *   The category definitions.
   */
  private function flowDays(): array {
    return [
      ['key' => 'd1', 'label' => 'Wed 16'],
      ['key' => 'd2', 'label' => 'Thu 17'],
      ['key' => 'd3', 'label' => 'Fri 18', 'cut' => TRUE],
      ['key' => 'today', 'label' => 'Sun 20', 'partial' => TRUE],
    ];
  }

  /**
   * Gets the standard rolling-window categories.
   *
   * @return array<int, array{key: string, label: string}>
   *   The category definitions.
   */
  private function windows(): array {
    return [
      ['key' => 'day', 'label' => '24 hours'],
      ['key' => 'week', 'label' => '7 days'],
      ['key' => 'month', 'label' => '30 days'],
    ];
  }

}
