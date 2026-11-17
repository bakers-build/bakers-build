<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\tool\Tool;

use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\bb_track\Entity\Worklog;

/**
 * Resolves worklog and reference UUIDs the caller may use.
 *
 * The using tool provides the entity repository as $repository.
 */
trait WorklogReferenceTrait {

  /**
   * Loads a worklog the caller may change or delete.
   *
   * @throws \InvalidArgumentException
   */
  private function editableWorklog(mixed $uuid, string $operation): Worklog {
    $entry = is_string($uuid) && Uuid::isValid($uuid) ? $this->repository->loadEntityByUuid('bb_track_worklog', $uuid) : NULL;
    if (!$entry instanceof Worklog || !$entry->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException('Worklog unavailable.');
    }
    if (!$entry->access($operation, $this->currentUser)) {
      // Roles, not people: naming the owner would disclose who recorded it.
      throw new \InvalidArgumentException(sprintf('You may not %s this worklog: only its owner may, while it is recorded or proposed, with record own worklog in its project’s workspace.', $operation === 'update' ? 'change' : 'delete'));
    }
    return $entry;
  }

  /**
   * Resolves a viewable reference UUID to its id.
   *
   * @throws \InvalidArgumentException
   * @throws \DomainException
   */
  private function reference(string $type, mixed $uuid): int {
    if (!is_string($uuid) || !Uuid::isValid($uuid)) {
      throw new \InvalidArgumentException('Project, ticket and billing account references must be UUIDs.');
    }
    $entity = $this->repository->loadEntityByUuid($type, $uuid);
    if (!$entity || !$entity->access('view', $this->currentUser)) {
      throw new \DomainException('Assignment unavailable.');
    }
    return (int) $entity->id();
  }

  /**
   * Runs a worklog write; the domain's own refusals become input errors.
   *
   * @throws \InvalidArgumentException
   */
  private function write(callable $write): void {
    try {
      $write();
    }
    catch (\DomainException $error) {
      throw new \InvalidArgumentException($error->getMessage(), 0, $error);
    }
    catch (EntityStorageException $error) {
      // Only the storage's own refusals; wrapped database errors stay hidden.
      if ($error->getPrevious() !== NULL) {
        throw $error;
      }
      throw new \InvalidArgumentException($error->getMessage(), 0, $error);
    }
  }

}
