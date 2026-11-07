<?php

declare(strict_types=1);

namespace Drupal\bb_core\RunLog;

use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\Field\Plugin\Field\FieldType\BooleanItem;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\TypedData\DataDefinition;

/**
 * A boolean item whose value makes a JSON:API normalization uncacheable.
 *
 * The run-log policy depends on the run's workspace and on settings, neither
 * of which invalidates the run's cache tags; max-age 0 keeps a cached
 * normalization from serving an outdated policy to the conductor.
 */
final class UncachedBooleanItem extends BooleanItem {

  /**
   * {@inheritdoc}
   *
   * @return array<string, \Drupal\Core\TypedData\DataDefinitionInterface>
   *   The parent's single `value` property, served as UncachedBooleanData.
   */
  public static function propertyDefinitions(FieldStorageDefinitionInterface $field_definition): array {
    $properties['value'] = DataDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Boolean value'))
      ->setRequired(TRUE)
      ->setClass(UncachedBooleanData::class);
    return $properties;
  }

}
