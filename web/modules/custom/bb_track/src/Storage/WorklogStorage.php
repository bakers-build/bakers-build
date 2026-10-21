<?php

declare(strict_types=1);

namespace Drupal\bb_track\Storage;

use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\Core\Entity\EntityTypeInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\bb_track\WorklogIntegrity;
use Drupal\bb_track\WorkTimeMutation;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\Sql\SqlContentEntityStorage;

/**
 * Every worklog writer participates in owner-scoped serialization.
 */
final class WorklogStorage extends SqlContentEntityStorage {

  /**
   * Checked application service.
   */
  private WorkTimeMutation $mutation;

  /**
   * Checked application service.
   */
  private WorklogIntegrity $integrity;

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    $instance = parent::createInstance($container, $entity_type);
    $instance->mutation = $container->get('bb_track.mutation');
    $instance->integrity = $container->get('bb_track.integrity');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function save($entity) {
    assert($entity instanceof Worklog);
    return $this->mutation->run('owner:' . $entity->getOwnerId(), function () use ($entity) {
      $original = $entity->isNew() ? NULL : $this->loadUnchanged($entity->id());
      assert($original instanceof Worklog || $original === NULL);
      if ($entity->expectedVersion !== NULL && (!$original || $original->version() !== $entity->expectedVersion)) {
        throw new EntityStorageException('This entry changed. Refresh before saving.');
      }
      $this->integrity->guardWorklog($entity, $original, FALSE);
      return parent::save($entity);
    });
  }

  /**
   * {@inheritdoc}
   */
  public function delete(array $entities): void {
    $owners = array_unique(array_map(static fn($entry) => (int) $entry->getOwnerId(), $entities));
    sort($owners);
    $remove = function () use ($entities): void {
      $persisted = [];
      foreach ($entities as $entity) {
        assert($entity instanceof Worklog);
        $original = $this->loadUnchanged($entity->id());
        assert($original instanceof Worklog || $original === NULL);
        if (!$original || ($entity->expectedVersion !== NULL && $original->version() !== $entity->expectedVersion)) {
          throw new EntityStorageException('This entry changed. Refresh before deleting.');
        }
        $this->integrity->guardWorklog($entity, $original, TRUE);
        $persisted[] = $original;
      }
      $remove = [];
      foreach ($persisted as $entity) {
        if (!$entity->get('source_keys')->isEmpty()) {
          $entity->set('voided', TRUE);
          parent::save($entity);
          continue;
        }
        $remove[] = $entity;
      }
      parent::delete($remove);
    };
    foreach (array_reverse($owners) as $owner) {
      $inner = $remove;
      $remove = fn() => $this->mutation->run('owner:' . $owner, $inner);
    }
    $remove();
  }

  /**
   * {@inheritdoc}
   */
  public function restore(EntityInterface $entity): never {
    throw new EntityStorageException('Restore cannot bypass personal time operations.');
  }

}
