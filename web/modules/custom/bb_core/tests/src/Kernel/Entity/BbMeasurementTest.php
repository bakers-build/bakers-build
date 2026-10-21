<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Entity;

use Drupal\Core\Config\Entity\ImportableEntityStorageInterface;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the reusable measurement configuration contract.
 */
#[Group('bb_core')]
final class BbMeasurementTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'bb_core'];

  /**
   * A stored measurement exposes its complete calculation definition.
   */
  public function testMeasurementRoundTripsItsDefinition(): void {
    $measurement = BbMeasurement::create([
      'id' => 'closed_tickets',
      'label' => 'Closed tickets',
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => [
        'entity_type' => 'bb_ticket',
        'time_field' => 'closed_date',
      ],
      'operation' => ['type' => 'count'],
      'predicates' => [
        ['field' => 'closed', 'operator' => '=', 'value' => TRUE],
      ],
      'bindings' => [
        'project' => ['field' => 'project_id', 'resolver' => 'entity_id'],
      ],
      'dimensions' => [
        'project' => [
          'field' => 'project_id',
          'entity_type' => 'bb_project',
        ],
      ],
    ]);
    $measurement->save();

    $loaded = BbMeasurement::load('closed_tickets');
    self::assertInstanceOf(BbMeasurementInterface::class, $loaded);
    self::assertSame('integer', $loaded->getValueType());
    self::assertSame('tickets', $loaded->getUnit());
    self::assertSame('bb_ticket', $loaded->getSource()['entity_type']);
    self::assertSame('count', $loaded->getOperation()['type']);
    self::assertSame('closed', $loaded->getPredicates()[0]['field']);
    self::assertSame('project_id', $loaded->getBindings()['project']['field']);
    self::assertSame('bb_project', $loaded->getDimensions()['project']['entity_type']);
  }

  /**
   * A derived measurement declares its referenced measurements as dependencies.
   */
  public function testDerivedMeasurementCalculatesDependencies(): void {
    $measurement = BbMeasurement::create([
      'id' => 'tickets_per_run',
      'label' => 'Tickets per run',
      'value_type' => 'decimal',
      'unit' => 'tickets_per_run',
      'source' => [],
      'operation' => [
        'type' => 'divide',
        'numerator' => 'closed_tickets',
        'denominator' => 'runs',
      ],
    ]);

    $dependencies = $measurement->calculateDependencies()->getDependencies();
    self::assertSame([
      'bb_core.bb_measurement.closed_tickets',
      'bb_core.bb_measurement.runs',
    ], $dependencies['config']);
  }

  /**
   * Derived measurements cannot save references to missing dependencies.
   */
  public function testDerivedMeasurementRejectsUnknownDependencies(): void {
    $measurement = BbMeasurement::create([
      'id' => 'invalid_ratio',
      'label' => 'Invalid ratio',
      'value_type' => 'decimal',
      'unit' => 'ratio',
      'operation' => [
        'type' => 'divide',
        'numerator' => 'missing_numerator',
        'denominator' => 'missing_denominator',
      ],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('unknown numerator');
    $measurement->save();
  }

  /**
   * Derived dependency graphs cannot be made cyclic by an update.
   */
  public function testDerivedMeasurementRejectsDependencyCycle(): void {
    $base = BbMeasurement::create([
      'id' => 'cycle_base',
      'label' => 'Cycle base',
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => ['entity_type' => 'user', 'time_field' => 'created'],
      'operation' => ['type' => 'count'],
    ]);
    $base->save();
    BbMeasurement::create([
      'id' => 'cycle_ratio',
      'label' => 'Cycle ratio',
      'value_type' => 'decimal',
      'unit' => 'ratio',
      'operation' => [
        'type' => 'divide',
        'numerator' => 'cycle_base',
        'denominator' => 'cycle_base',
      ],
    ])->save();
    $base->set('source', []);
    $base->set('operation', [
      'type' => 'divide',
      'numerator' => 'cycle_ratio',
      'denominator' => 'cycle_ratio',
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('cyclic dependency');
    $base->save();
  }

  /**
   * Query bindings accept only resolver implementations available at runtime.
   */
  public function testMeasurementRejectsUnknownBindingResolver(): void {
    $measurement = BbMeasurement::create([
      'id' => 'invalid_binding',
      'label' => 'Invalid binding',
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => ['entity_type' => 'bb_ticket', 'time_field' => 'closed_date'],
      'operation' => ['type' => 'count'],
      'bindings' => [
        'project' => ['field' => 'project_id', 'resolver' => 'invented'],
      ],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('unsupported binding resolver');
    $measurement->save();
  }

  /**
   * Configuration imports run the same dependency validation as form saves.
   */
  public function testImportRejectsUnknownDerivedDependency(): void {
    $name = 'bb_core.bb_measurement.imported_invalid_ratio';
    $new = $this->container->get('config.factory')->getEditable($name);
    $old = clone $new;
    $new->setData([
      'id' => 'imported_invalid_ratio',
      'label' => 'Imported invalid ratio',
      'value_type' => 'decimal',
      'unit' => 'ratio',
      'source' => [],
      'operation' => [
        'type' => 'divide',
        'numerator' => 'missing_numerator',
        'denominator' => 'missing_denominator',
      ],
      'predicates' => [],
      'bindings' => [],
      'dimensions' => [],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('unknown numerator');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_measurement');
    self::assertInstanceOf(ImportableEntityStorageInterface::class, $storage);
    $storage->importCreate($name, $new, $old);
  }

  /**
   * Typed configuration rejects resolver names unavailable at runtime.
   */
  public function testSchemaRejectsUnknownBindingResolver(): void {
    $typed = $this->container->get('config.typed')->createFromNameAndData(
      'bb_core.bb_measurement.invalid_schema_binding',
      [
        'id' => 'invalid_schema_binding',
        'label' => 'Invalid schema binding',
        'value_type' => 'integer',
        'unit' => 'tickets',
        'source' => ['entity_type' => 'user', 'time_field' => 'created'],
        'operation' => ['type' => 'count'],
        'predicates' => [],
        'bindings' => [
          'project' => ['field' => 'project_id', 'resolver' => 'invented'],
        ],
        'dimensions' => [],
      ],
    );

    $paths = [];
    foreach ($typed->validate() as $violation) {
      $paths[] = $violation->getPropertyPath();
    }
    self::assertContains('bindings.project.resolver', $paths);
  }

}
