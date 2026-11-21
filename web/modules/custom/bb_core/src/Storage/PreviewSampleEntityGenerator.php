<?php

declare(strict_types=1);

namespace Drupal\bb_core\Storage;

use Drupal\Core\Entity\ContentEntityStorageInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\Plugin\Field\FieldType\EntityReferenceItem;
use Drupal\ui_patterns\Entity\SampleEntityGenerator;

/**
 * Generates previews without recursively expanding entity references.
 *
 * Applies to every content entity type: a display import runs as the anonymous
 * CLI user, for whom core expands each reference into a further sample.
 */
final class PreviewSampleEntityGenerator extends SampleEntityGenerator {

  /**
   * {@inheritdoc}
   */
  public function get(string $entity_type_id, string $bundle_id): EntityInterface {
    $tempstore = $this->tempStoreFactory->get('ui_patterns.sample_entity');
    $key = "$entity_type_id.$bundle_id";
    $sample = $tempstore->get($key);
    if ($sample !== NULL) {
      return $sample;
    }

    $storage = $this->entityTypeManager->getStorage($entity_type_id);
    if (!$storage instanceof ContentEntityStorageInterface) {
      return parent::get($entity_type_id, $bundle_id);
    }
    $bundle_key = $storage->getEntityType()->getKey('bundle');
    $empty = $storage->create($bundle_key ? [$bundle_key => $bundle_id] : []);
    assert($empty instanceof FieldableEntityInterface);
    $values = [];
    $state_fields = [];
    foreach ($empty->getFieldDefinitions() as $name => $field) {
      if ($field->isComputed() || is_a($field->getItemDefinition()->getClass(), EntityReferenceItem::class, TRUE)) {
        // Core expands inaccessible references into more samples recursively.
        $values[$name] = [];
      }
      elseif ($field->getType() === 'state') {
        // State defaults need the workflow generated with the other scalars.
        $values[$name] = [];
        $state_fields[] = $name;
      }
    }
    $sample = $storage->createWithSampleValues($bundle_id, $values);
    foreach ($state_fields as $name) {
      $sample->get($name)->applyDefaultValue();
    }
    $tempstore->set($key, $sample);
    return $sample;
  }

}
