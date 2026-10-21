<?php

declare(strict_types=1);

namespace Drupal\bb_core\Storage;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\Sql\SqlContentEntityStorage;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Wraps ticket saves so what the save hooks write shares its transaction.
 */
final class BbTicketStorage extends SqlContentEntityStorage {

  /**
   * {@inheritdoc}
   */
  public function save(EntityInterface $entity) {
    $transaction = $this->database->startTransaction();
    try {
      $this->replaced($entity);
      $return = parent::save($entity);
      $transaction->commitOrRelease();
      return $return;
    }
    catch (\Throwable $e) {
      $transaction->rollBack();
      if ($e instanceof EntityStorageException) {
        throw $e;
      }
      throw new EntityStorageException($e->getMessage(), (int) $e->getCode(), $e);
    }
  }

  /**
   * Sets the stored ticket this save replaces as the entity's original.
   *
   * Read after the row lock, so the hooks that run inside the save compare
   * against the stored predecessor: an original whose state is not the
   * locked state is stale and replaced. An insert has none.
   */
  private function replaced(EntityInterface $entity): void {
    if ($entity->isNew() || !$entity->id() || !$entity instanceof BbTicketInterface) {
      return;
    }
    $locked = $this->lockPersistedState((string) $entity->id());
    $original = $entity->getOriginal();
    if (!$original instanceof BbTicketInterface || (string) $original->get('state')->value !== $locked) {
      $original = $this->loadUnchanged($entity->id());
    }
    if ($original instanceof BbTicketInterface) {
      $entity->setOriginal($original);
    }
  }

  /**
   * Locks the ticket row and returns the stored state.
   */
  private function lockPersistedState(string $id): string {
    $id_key = $this->getEntityType()->getKey('id');
    assert(is_string($id_key) && $id_key !== '');
    $select = $this->database->select($this->getBaseTable(), 't');
    $select->fields('t', ['state']);
    $select->condition($id_key, $id);
    $select->forUpdate();
    $value = $select->execute()->fetchField();
    return $value === FALSE ? '' : (string) $value;
  }

}
