<?php

declare(strict_types=1);

namespace Drupal\bb_core\Storage;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Entity\Sql\SqlContentEntityStorageSchema;

/**
 * Lets the database refuse a second workspace with one slug.
 *
 * `BbWorkspaceSlug` validation reads the table before a save; two concurrent
 * creations both read it as free, so only this key stops the second.
 */
final class BbWorkspaceStorageSchema extends SqlContentEntityStorageSchema {

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function getEntitySchema(ContentEntityTypeInterface $entity_type, $reset = FALSE): array {
    $schema = parent::getEntitySchema($entity_type, $reset);
    $schema[$entity_type->getBaseTable()]['unique keys']['bb_workspace__slug'] = ['slug'];
    return $schema;
  }

}
