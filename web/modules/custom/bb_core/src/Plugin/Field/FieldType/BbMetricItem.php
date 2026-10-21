<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldType;

use Drupal\Core\Field\Attribute\FieldType;
use Drupal\Core\Field\FieldItemBase;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\TypedData\DataDefinition;

/**
 * A single named metric: name + value (+ optional unit + recorded timestamp).
 *
 * Reusable across entities. The name is a free-string data value, so new
 * metric names need no schema change. The value is decimal(12,4) for exact
 * aggregation over counts/ratios/hours, never float.
 */
#[FieldType(
  id: 'bb_metric',
  label: new TranslatableMarkup('bakers.build metric'),
  description: new TranslatableMarkup('A named metric: name, value, optional unit and recorded time.'),
  default_widget: 'bb_metric_default',
  default_formatter: 'bb_metric_default',
)]
final class BbMetricItem extends FieldItemBase {

  /**
   * {@inheritdoc}
   */
  public static function schema(FieldStorageDefinitionInterface $field_definition): array {
    return [
      'columns' => [
        'name' => ['type' => 'varchar', 'length' => 64, 'not null' => FALSE],
        'value' => ['type' => 'numeric', 'precision' => 12, 'scale' => 4, 'not null' => FALSE],
        'unit' => ['type' => 'varchar', 'length' => 32, 'not null' => FALSE],
        'recorded' => ['type' => 'int', 'not null' => FALSE],
      ],
      'indexes' => [
        'name' => ['name'],
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public static function propertyDefinitions(FieldStorageDefinitionInterface $field_definition): array {
    $properties = [];
    $properties['name'] = DataDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Name'))
      ->setRequired(TRUE);
    $properties['value'] = DataDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Value'))
      ->setRequired(TRUE);
    $properties['unit'] = DataDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Unit'));
    $properties['recorded'] = DataDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Recorded'));
    return $properties;
  }

  /**
   * {@inheritdoc}
   */
  public function isEmpty(): bool {
    $name = $this->get('name')->getValue();
    return $name === NULL || $name === '';
  }

  /**
   * {@inheritdoc}
   */
  public static function mainPropertyName(): string {
    return 'value';
  }

}
