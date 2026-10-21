<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\bb_core\Statistics\Figure\FigureFilterResolver;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementResult;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers atomic category-by-measurement figure payloads.
 */
#[Group('bb_core')]
final class FigureEvaluatorTest extends KernelTestBase {

  private const NOW = 1789920000;

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
   * The selected period overrides the default and preserves partial metadata.
   */
  public function testLinePayloadUsesSelectedPeriodFilter(): void {
    $categories = [
      ['key' => '2026-09-19', 'label' => 'Sat 19'],
      ['key' => '2026-09-20', 'label' => 'Sun 20', 'partial' => TRUE],
    ];
    $measurementEvaluator = $this->fake([
      'closed_tickets' => $this->measurementResult(
        'closed_tickets', 'Closed tickets', 'integer', 'tickets',
        $categories, ['2026-09-19' => 1, '2026-09-20' => 2],
      ),
      'runs' => $this->measurementResult(
        'runs', 'Runs', 'integer', 'runs',
        $categories, ['2026-09-19' => 3, '2026-09-20' => 4],
      ),
    ]);
    /** @var object{categoryDefinitions: array<int, array<string, mixed>>}&MeasurementEvaluatorInterface $measurementEvaluator */
    $evaluator = $this->evaluatorFrom($measurementEvaluator);
    $figure = $this->figure('activity', 'Activity', 'line', ['type' => 'days'], ['closed_tickets', 'runs'], [
      'period' => [
        'label' => 'Period',
        'default' => '7',
        'options' => [
          ['value' => '7', 'label' => '7 days'],
          ['value' => '30', 'label' => '30 days'],
        ],
      ],
    ]);

    $payload = $evaluator->evaluate($figure, [], ['period' => '30'], self::NOW)->toArray();

    self::assertSame('30', $payload['filters']['period']['value']);
    self::assertSame('30', $measurementEvaluator->categoryDefinitions[0]['period']);
    self::assertTrue($payload['categories'][1]['partial']);
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
   * Unsupported filter keys and values are rejected before measurements run.
   */
  public function testFiltersAreValidated(): void {
    $figure = $this->figure('filtered', 'Filtered', 'line', ['type' => 'days'], ['closed_tickets'], [
      'period' => [
        'label' => 'Period',
        'default' => '7',
        'options' => [['value' => '7', 'label' => '7 days'], ['value' => '30', 'label' => '30 days']],
      ],
    ]);
    $evaluator = $this->evaluator([]);

    try {
      $evaluator->evaluate($figure, [], ['unknown' => '7'], self::NOW);
      self::fail('An unknown filter key was accepted.');
    }
    catch (\InvalidArgumentException $exception) {
      self::assertStringContainsString('unknown filter', strtolower($exception->getMessage()));
    }

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('Unsupported value');
    $evaluator->evaluate($figure, [], ['period' => '14'], self::NOW);
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
    $this->expectExceptionMessage('"days" or "months"');
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
      new FigureFilterResolver(),
    );
  }

  /**
   * Creates a measurement evaluator that returns fixed results.
   *
   * @param array<string, MeasurementResult> $results
   *   The results keyed by measurement ID.
   */
  private function fake(array $results): MeasurementEvaluatorInterface {
    return new class($results) implements MeasurementEvaluatorInterface {

      /** @var array<int, array<string, mixed>> */
      public array $categoryDefinitions = [];

      /**
       * Constructs the fake evaluator.
       *
       * @param array<string, MeasurementResult> $results
       *   The results keyed by measurement ID.
       */
      public function __construct(private readonly array $results) {}

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
