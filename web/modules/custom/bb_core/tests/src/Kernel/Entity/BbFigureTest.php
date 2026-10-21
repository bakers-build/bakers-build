<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Entity;

use Drupal\Core\Config\Entity\ImportableEntityStorageInterface;
use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\BbFigureInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the atomic figure configuration contract.
 */
#[Group('bb_core')]
final class BbFigureTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'bb_core'];

  /**
   * A figure cannot be saved without at least one measurement.
   */
  public function testFigureRejectsAnEmptyMeasurementList(): void {
    $figure = BbFigure::create([
      'id' => 'empty',
      'label' => 'Empty',
      'widget' => 'matrix',
      'measurements' => [],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('at least one measurement');
    $figure->save();
  }

  /**
   * The figure preserves ordered references and plugin configuration.
   */
  public function testFigureExposesConditionsAndDependencies(): void {
    $figure = BbFigure::create([
      'id' => 'project_overview',
      'label' => 'Project overview',
      'description' => 'Project throughput windows.',
      'weight' => 4,
      'widget' => 'matrix',
      'measurements' => ['closed_tickets', 'runs', 'tickets_per_run'],
      'categories' => [
        'type' => 'windows',
        'values' => ['day', 'week', 'month'],
      ],
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
    ]);

    self::assertInstanceOf(BbFigureInterface::class, $figure);
    self::assertSame(['closed_tickets', 'runs', 'tickets_per_run'], $figure->getMeasurements());
    self::assertSame(['project'], $figure->getContextShape());
    self::assertSame('matrix', $figure->getWidget());
    self::assertSame(
      ['entity' => 'project'],
      $figure->getCondition('project')->getConfiguration()['context_mapping'],
    );

    $dependencies = $figure->calculateDependencies()->getDependencies();
    self::assertSame([
      'bb_core.bb_measurement.closed_tickets',
      'bb_core.bb_measurement.runs',
      'bb_core.bb_measurement.tickets_per_run',
    ], $dependencies['config']);
  }

  /**
   * Figures cannot save references to missing measurements.
   */
  public function testFigureRejectsUnknownMeasurementReference(): void {
    $figure = $this->figure(['measurements' => ['missing']]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('unknown measurement');
    $figure->save();
  }

  /**
   * Category types and dimension keys must be evaluable before runtime.
   */
  public function testFigureRejectsInvalidCategoryDefinition(): void {
    $this->measurement('closed_tickets', []);
    $figure = $this->figure([
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'dimension', 'dimension' => 'project'],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('does not define dimension');
    $figure->save();
  }

  /**
   * Figures accept only category strategies implemented by the evaluator.
   */
  public function testFigureRejectsUnknownCategoryType(): void {
    $this->measurement('closed_tickets', []);
    $figure = $this->figure([
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'invented'],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('unsupported category type');
    $figure->save();
  }

  /**
   * A filter default must name one unique configured option.
   */
  public function testFigureRejectsFilterDefaultOutsideOptions(): void {
    $this->measurement('closed_tickets', []);
    $figure = $this->figure([
      'measurements' => ['closed_tickets'],
      'filters' => [
        'period' => [
          'label' => 'Period',
          'default' => '14',
          'options' => [
            ['value' => '7', 'label' => '7 days'],
            ['value' => '30', 'label' => '30 days'],
          ],
        ],
      ],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('default');
    $figure->save();
  }

  /**
   * Filter options must be unique values supported by the period evaluator.
   */
  public function testFigureRejectsInvalidFilterOptions(): void {
    $this->measurement('closed_tickets', []);
    $figure = $this->figure([
      'measurements' => ['closed_tickets'],
      'filters' => [
        'period' => [
          'label' => 'Period',
          'default' => '7',
          'options' => [
            ['value' => '7', 'label' => 'First week'],
            ['value' => '7', 'label' => 'Duplicate week'],
          ],
        ],
      ],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('unique non-empty options');
    $figure->save();
  }

  /**
   * Configuration imports run the same reference validation as form saves.
   */
  public function testImportRejectsUnknownMeasurementReference(): void {
    $name = 'bb_core.bb_figure.imported_invalid_figure';
    $new = $this->container->get('config.factory')->getEditable($name);
    $old = clone $new;
    $new->setData([
      'id' => 'imported_invalid_figure',
      'label' => 'Imported invalid figure',
      'description' => '',
      'weight' => 0,
      'widget' => 'matrix',
      'measurements' => ['missing'],
      'categories' => ['type' => 'windows', 'values' => ['day']],
      'filters' => [],
      'context_shape' => ['user'],
      'conditions' => [],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('unknown measurement');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_figure');
    self::assertInstanceOf(ImportableEntityStorageInterface::class, $storage);
    $storage->importCreate($name, $new, $old);
  }

  /**
   * Typed configuration rejects unsupported category and filter values.
   */
  public function testSchemaRejectsInvalidCategoryAndFilterValues(): void {
    $typed = $this->container->get('config.typed')->createFromNameAndData(
      'bb_core.bb_figure.invalid_schema_figure',
      [
        'id' => 'invalid_schema_figure',
        'label' => 'Invalid schema figure',
        'description' => '',
        'weight' => 0,
        'widget' => 'matrix',
        'measurements' => ['closed_tickets'],
        'categories' => ['type' => 'invented'],
        'filters' => [
          'period' => [
            'label' => 'Period',
            'default' => '14',
            'options' => [['value' => '14', 'label' => '14 days']],
          ],
        ],
        'context_shape' => ['user'],
        'conditions' => [],
      ],
    );

    $paths = [];
    foreach ($typed->validate() as $violation) {
      $paths[] = $violation->getPropertyPath();
    }
    self::assertContains('categories.type', $paths);
    self::assertContains('filters.period.default', $paths);
    self::assertContains('filters.period.options.0.value', $paths);
  }

  /**
   * The series source round-trips and defaults to an empty array.
   */
  public function testSeriesRoundTrip(): void {
    $this->measurement('run_tokens', ['model' => ['field' => 'model']]);
    $figure = BbFigure::create([
      'id' => 'series_figure',
      'label' => 'Series figure',
      'widget' => 'line',
      'measurements' => ['run_tokens'],
      'categories' => ['type' => 'days'],
      'series' => ['dimension' => 'model', 'limit' => 5],
    ]);
    $figure->save();
    $reloaded = BbFigure::load('series_figure');
    self::assertSame(['dimension' => 'model', 'limit' => 5], $reloaded->getSeries());
    self::assertSame([], BbFigure::create(['id' => 'plain', 'label' => 'Plain'])->getSeries());
  }

  /**
   * An empty series mapping is valid typed config.
   */
  public function testEmptySeriesMappingHasNoTypedDataViolations(): void {
    $this->measurement('run_tokens', ['model' => ['field' => 'model']]);
    $typed = $this->container->get('config.typed')->createFromNameAndData(
      'bb_core.bb_figure.empty_series_figure',
      [
        'id' => 'empty_series_figure',
        'label' => 'Empty series figure',
        'description' => '',
        'weight' => 0,
        'widget' => 'line',
        'measurements' => ['run_tokens'],
        'categories' => ['type' => 'days'],
        'series' => [],
        'filters' => [],
        'context_shape' => ['user'],
        'conditions' => [],
      ],
    );

    self::assertCount(0, $typed->validate());
  }

  /**
   * Creates a minimal figure with optional overrides.
   */
  private function figure(array $overrides): BbFigure {
    return BbFigure::create($overrides + [
      'id' => 'validation_figure',
      'label' => 'Validation figure',
      'widget' => 'matrix',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'windows', 'values' => ['day', 'week', 'month']],
      'filters' => [],
      'context_shape' => ['user'],
      'conditions' => [],
    ]);
  }

  /**
   * Saves a minimal count measurement with the supplied dimensions.
   */
  private function measurement(string $id, array $dimensions): void {
    BbMeasurement::create([
      'id' => $id,
      'label' => $id,
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => ['entity_type' => 'user', 'time_field' => 'created'],
      'operation' => ['type' => 'count'],
      'bindings' => [],
      'dimensions' => $dimensions,
    ])->save();
  }

}
