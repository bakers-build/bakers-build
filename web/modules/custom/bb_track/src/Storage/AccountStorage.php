<?php

declare(strict_types=1);

namespace Drupal\bb_track\Storage;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\bb_core\Entity\EntityDeleteRules;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\WorkTimeMutation;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\bb_track\AccountGuard;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\Sql\SqlContentEntityStorage;

/**
 * Every billing account writer satisfies the content invariants under lock.
 *
 * Who may configure a project's accounts is decided by the application
 * operation and the access handler, not here: recipe imports and other
 * direct writers must still produce consistent accounts.
 */
final class AccountStorage extends SqlContentEntityStorage {

  /**
   * Checked application service.
   */
  private AccountGuard $guard;

  /**
   * Checked application service.
   */
  private WorkTimeMutation $mutation;

  /**
   * The delete rules that cascade a project delete.
   */
  private EntityDeleteRules $deleteRules;

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    $instance = parent::createInstance($container, $entity_type);
    $instance->guard = $container->get('bb_track.account_guard');
    $instance->mutation = $container->get('bb_track.mutation');
    $instance->deleteRules = $container->get('bb_core.entity_delete_rules');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function save($entity) {
    assert($entity instanceof Account);
    return $this->mutation->run('assignments', function () use ($entity) {
      $this->guard->validate($entity);
      return parent::save($entity);
    });
  }

  /**
   * {@inheritdoc}
   */
  public function delete(array $entities): void {
    // Only together with its project; on its own an account is archived.
    foreach ($entities as $entity) {
      if (!$this->deleteRules->isCascading($entity)) {
        throw new EntityStorageException('Billing accounts must be archived instead of deleted.');
      }
    }
    parent::delete($entities);
  }

  /**
   * {@inheritdoc}
   */
  public function restore(EntityInterface $entity): never {
    throw new EntityStorageException('Restore cannot bypass billing account operations.');
  }

}
