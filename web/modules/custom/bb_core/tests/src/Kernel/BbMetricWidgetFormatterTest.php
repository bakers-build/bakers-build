<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\entity_test\Entity\EntityTest;
use Drupal\bb_core\Plugin\Field\FieldWidget\BbMetricDefaultWidget;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the human read path: the bb_metric_default formatter output.
 *
 * The formatter renders "name: value unit" for each metric delta (BB-172);
 * the agent write path is JSON:API, not the widget.
 */
#[Group('bb_core')]
final class BbMetricWidgetFormatterTest extends KernelTestBase {

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
   * The formatter renders name, value and unit for a metric.
   */
  public function testFormatterRendersNameValueUnit(): void {
    $entity = EntityTest::create(['metrics' => [['name' => 'ac_pass_rate', 'value' => '0.8000', 'unit' => 'ratio']]]);
    $build = $this->container->get('entity_display.repository')
      ->getViewDisplay('entity_test', 'entity_test', 'default')
      ->setComponent('metrics', ['type' => 'bb_metric_default'])
      ->build($entity);
    $rendered = (string) $this->container->get('renderer')->renderRoot($build['metrics'][0]);
    $this->assertStringContainsString('ac_pass_rate', $rendered);
    $this->assertStringContainsString('0.8', $rendered);
    $this->assertStringContainsString('ratio', $rendered);
  }

  /**
   * The widget massages empty optional inputs to NULL, not '' (BB-172 #1).
   *
   * The human write path leaves "Recorded" (and "Unit") blank. Core's form
   * elements submit those as ''; unmassaged, '' flows into the nullable int
   * `recorded` column and MariaDB strict mode rejects it ("Incorrect integer
   * value: ''") — a 500 on the ordinary edit-and-save. massageFormValues must
   * cast blank optionals to NULL so the empty value lands as a clean SQL NULL.
   */
  public function testWidgetMassagesEmptyOptionalsToNull(): void {
    $field_definition = $this->container->get('entity_field.manager')
      ->getFieldDefinitions('entity_test', 'entity_test')['metrics'];
    $widget = $this->container->get('plugin.manager.field.widget')->createInstance('bb_metric_default', [
      'field_definition' => $field_definition,
      'form_mode' => 'default',
      'settings' => [],
      'third_party_settings' => [],
    ]);
    $this->assertInstanceOf(BbMetricDefaultWidget::class, $widget);
    $massaged = $widget->massageFormValues(
      [['name' => 'ac_pass_rate', 'value' => '0.8', 'unit' => '', 'recorded' => '']],
      [],
      new FormState(),
    );
    $this->assertNull($massaged[0]['recorded']);
    $this->assertNull($massaged[0]['unit']);
    $this->assertSame('0.8', $massaged[0]['value']);
    $this->assertSame('ac_pass_rate', $massaged[0]['name']);
  }

}
