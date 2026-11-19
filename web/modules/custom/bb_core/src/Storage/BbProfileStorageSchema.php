<?php

declare(strict_types=1);

namespace Drupal\bb_core\Storage;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Entity\Sql\SqlContentEntityStorageSchema;

/**
 * Lets the database refuse a second profile for one account and workspace.
 */
final class BbProfileStorageSchema extends SqlContentEntityStorageSchema {

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function getEntitySchema(ContentEntityTypeInterface $entity_type, $reset = FALSE): array {
    $schema = parent::getEntitySchema($entity_type, $reset);
    $schema[$entity_type->getBaseTable()]['unique keys']['bb_profile__uid_workspace'] = ['uid', 'workspace_id'];
    return $schema;
  }

}
