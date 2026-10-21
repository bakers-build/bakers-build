<?php

declare(strict_types=1);

namespace Drupal\bb_core\Storage;

use Drupal\Core\Entity\ContentEntityStorageInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\Plugin\Field\FieldType\EntityReferenceItem;
use Drupal\bb_core\Entity\BbContentEntityInterface;
use Drupal\ui_patterns\Entity\SampleEntityGenerator;

/**
 * Generates bakers.build previews without recursively expanding entity references.
 */
final class PreviewSampleEntityGenerator extends SampleEntityGenerator {

  /**
   * {@inheritdoc}
   */
  public function get(string $entity_type_id, string $bundle_id): EntityInterface {
    $definition = $this->entityTypeManager->getDefinition($entity_type_id);
    if (!self::isBbType($definition)) {
      return parent::get($entity_type_id, $bundle_id);
    }

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
    $bundle_key = $definition->getKey('bundle');
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

  /**
   * Whether a type is bakers.build's: bb_core's, or one extending its entity base.
   */
  private static function isBbType(EntityTypeInterface $definition): bool {
    return $definition->getProvider() === 'bb_core'
      || $definition->entityClassImplements(BbContentEntityInterface::class);
  }

}
