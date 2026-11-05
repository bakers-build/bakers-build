<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Sql\DefaultTableMapping;
use Drupal\Core\Entity\Sql\SqlEntityStorageInterface;

/**
 * Leaves references to an entity dangling, as data from before delete rules.
 *
 * An entity delete now blocks, cascades or detaches its references
 * (EntityDeleteRules), so `->delete()` can no longer produce a dangling
 * reference. Rows written before those rules may still hold one, and the
 * code reading them must stay safe; this removes only the entity's own rows.
 */
trait DanglingReferenceTrait {

  /**
   * Removes the entity's rows without running delete hooks or rules.
   */
  protected function removeRowsOnly(ContentEntityInterface $entity): void {
    $storage = $this->container->get('entity_type.manager')->getStorage($entity->getEntityTypeId());
    self::assertInstanceOf(SqlEntityStorageInterface::class, $storage);
    $mapping = $storage->getTableMapping();
    self::assertInstanceOf(DefaultTableMapping::class, $mapping);
    $id_key = $entity->getEntityType()->getKey('id');
    self::assertIsString($id_key);
    $tables = array_unique(array_merge([$mapping->getBaseTable(), $mapping->getDataTable()], $mapping->getDedicatedTableNames()));
    $database = $this->container->get('database');
    foreach (array_filter($tables) as $table) {
      // Revision tables are named for every type but exist only when used.
      if (!$database->schema()->tableExists($table)) {
        continue;
      }
      $column = in_array($table, $mapping->getDedicatedTableNames(), TRUE) ? 'entity_id' : $id_key;
      $database->delete($table)->condition($column, $entity->id())->execute();
    }
    $storage->resetCache([$entity->id()]);
  }

}
