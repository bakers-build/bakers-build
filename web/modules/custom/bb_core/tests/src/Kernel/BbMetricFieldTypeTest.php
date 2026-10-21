<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\entity_test\Entity\EntityTest;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the bb_metric field type schema and value round-trip.
 *
 * A single named metric carries {name, value, unit?, recorded?}; the name is a
 * free string so new metric names need no schema change (BB-172 AC-1).
 */
#[Group('bb_core')]
final class BbMetricFieldTypeTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'field', 'user', 'options', 'entity', 'state_machine',
    'og',
    'link', 'text', 'entity_test', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('entity_test');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('user');
    $this->container->get('entity_type.manager')->getStorage('field_storage_config')->create([
      'field_name' => 'metrics',
      'entity_type' => 'entity_test',
      'type' => 'bb_metric',
      'cardinality' => -1,
    ])->save();
    $this->container->get('entity_type.manager')->getStorage('field_config')->create([
      'field_name' => 'metrics',
      'entity_type' => 'entity_test',
      'bundle' => 'entity_test',
    ])->save();
  }

  /**
   * Multiple metrics survive a save/load round-trip with all sub-properties.
   */
  public function testSchemaAndRoundTrip(): void {
    $entity = EntityTest::create([
      'metrics' => [
      ['name' => 'ac_pass_rate', 'value' => '0.8000', 'unit' => 'ratio', 'recorded' => 1700000000],
      ['name' => 'review_bounces', 'value' => '2.0000'],
      ],
    ]);
    $entity->save();

    $reloaded = EntityTest::load($entity->id());
    $metrics = $reloaded->get('metrics');
    $this->assertCount(2, $metrics);
    $this->assertSame('ac_pass_rate', $metrics[0]->get('name')->getValue());
    // Compare numerically: the returned scale is the database's, not the
    // field's. MariaDB's `decimal(x,4)` round-trips '0.8000'; sqlite has no
    // decimal type and returns '0.8'. This test asserts the round-trip, so
    // pinning the string would only pin the test database.
    $value = $metrics[0]->get('value')->getValue();
    $this->assertEqualsWithDelta(0.8, (float) $value, 0.00001);
    $this->assertSame('ratio', $metrics[0]->get('unit')->getValue());
    $this->assertSame(1700000000, (int) $metrics[0]->get('recorded')->getValue());
    $this->assertSame('review_bounces', $metrics[1]->get('name')->getValue());
  }

  /**
   * IsEmpty() is true iff the metric name is empty.
   */
  public function testIsEmpty(): void {
    $item = $this->container->get('plugin.manager.field.field_type')
      ->createInstance('bb_metric', [
        'field_definition' => BaseFieldDefinition::create('bb_metric'),
        'name' => 'x',
        'parent' => NULL,
      ]);
    $item->setValue(['name' => '', 'value' => '1.0000']);
    $this->assertTrue($item->isEmpty());
    $item->setValue(['name' => 'tokens', 'value' => '1.0000']);
    $this->assertFalse($item->isEmpty());
  }

}
