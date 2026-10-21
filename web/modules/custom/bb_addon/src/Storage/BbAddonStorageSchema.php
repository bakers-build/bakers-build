<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Storage;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Entity\Sql\SqlContentEntityStorageSchema;
use Drupal\Core\Field\FieldStorageDefinitionInterface;

/**
 * Enforces registration identity: one row per (workspace, name, version).
 *
 * BB-661/BB-660: two conductors in the same workspace registering the
 * same name@version must resolve to exactly one row. The unique key is the
 * database-level guarantee a reload-on-collision retry (AddonsRegisterResource)
 * relies on under concurrent registration.
 *
 * `workspace_id` is entity-required but kept DB-nullable so installing the
 * field against a site with existing rows does not fail; the post-update
 * backfill fills every row before anything relies on it being non-null.
 */
final class BbAddonStorageSchema extends SqlContentEntityStorageSchema {

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function getEntitySchema(ContentEntityTypeInterface $entity_type, $reset = FALSE): array {
    $schema = parent::getEntitySchema($entity_type, $reset);
    $table = $entity_type->getBaseTable();
    $workspace_column = match (TRUE) {
      isset($schema[$table]['fields']['workspace_id__target_id']) => 'workspace_id__target_id',
      isset($schema[$table]['fields']['workspace_id']) => 'workspace_id',
      default => NULL,
    };
    if ($workspace_column !== NULL) {
      $schema[$table]['unique keys']['bb_addon__workspace_name_version'] = [
        $workspace_column,
        'name',
        'version',
      ];
    }
    return $schema;
  }

  /**
   * {@inheritdoc}
   */
  protected function getSharedTableFieldSchema(FieldStorageDefinitionInterface $storage_definition, $table_name, array $schema): array {
    $schema = parent::getSharedTableFieldSchema($storage_definition, $table_name, $schema);
    if ($storage_definition->getName() === 'workspace_id') {
      foreach (array_keys($schema['fields']) as $column) {
        $schema['fields'][$column]['not null'] = FALSE;
      }
    }
    return $schema;
  }

}
