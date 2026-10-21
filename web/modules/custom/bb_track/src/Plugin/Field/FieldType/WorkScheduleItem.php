<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\Field\FieldType;

use Drupal\Core\Field\Attribute\FieldType;
use Drupal\Core\Field\FieldItemBase;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\TypedData\DataDefinition;

/**
 * Seven weekday durations and an optional proposal cap.
 */
#[FieldType(id: 'bb_work_schedule', label: new TranslatableMarkup('Work schedule'))]
final class WorkScheduleItem extends FieldItemBase {

  /**
   * {@inheritdoc}
   */
  public static function propertyDefinitions(FieldStorageDefinitionInterface $field_definition): array {
    $properties = [];
    for ($day = 0; $day < 7; $day++) {
      $properties['day_' . $day] = DataDefinition::create('integer')->setLabel(new TranslatableMarkup('Weekday seconds'))->setRequired(TRUE);
    }
    $properties['cap'] = DataDefinition::create('integer')->setLabel(new TranslatableMarkup('Proposal day cap'));
    return $properties;
  }

  /**
   * {@inheritdoc}
   */
  public static function schema(FieldStorageDefinitionInterface $field_definition): array {
    $columns = [];
    for ($day = 0; $day < 7; $day++) {
      $columns['day_' . $day] = ['type' => 'int'];
    }
    $columns['cap'] = ['type' => 'int'];
    return ['columns' => $columns];
  }

  /**
   * {@inheritdoc}
   */
  public function isEmpty(): bool {
    for ($day = 0; $day < 7; $day++) {
      if ($this->get('day_' . $day)->getValue() !== NULL) {
        return FALSE;
      }
    }
    return TRUE;
  }

}
