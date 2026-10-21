<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Storage;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Entity\Sql\SqlContentEntityStorageSchema;

/**
 * Adds the ticket/id index.
 */
final class BbActivityStorageSchema extends SqlContentEntityStorageSchema {

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function getEntitySchema(ContentEntityTypeInterface $entity_type, $reset = FALSE): array {
    $schema = parent::getEntitySchema($entity_type, $reset);
    $table = $entity_type->getBaseTable();
    if (isset($schema[$table]['fields']['ticket_id'])) {
      $schema[$table]['indexes']['bb_activity__ticket_id__id'] = ['ticket_id', 'id'];
    }
    elseif (isset($schema[$table]['fields']['ticket_id__target_id'])) {
      $schema[$table]['indexes']['bb_activity__ticket_id__id'] = ['ticket_id__target_id', 'id'];
    }
    return $schema;
  }

}
