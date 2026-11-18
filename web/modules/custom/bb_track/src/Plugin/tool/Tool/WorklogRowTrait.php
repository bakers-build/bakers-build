<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\tool\Tool;

use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_track\Entity\Worklog;

/**
 * One worklog as a tool row, with only the references the caller may read.
 *
 * The using tool provides the entity type manager as $entities.
 */
trait WorklogRowTrait {

  /**
   * Row keys of the references and their entity types.
   */
  private const REFERENCES = [
    'project_id' => 'bb_project',
    'ticket_id' => 'bb_ticket',
    'submission_id' => 'bb_track_submission',
    'account' => 'bb_track_account',
  ];

  /**
   * One worklog row.
   *
   * @param \Drupal\bb_track\Entity\Worklog $entry
   *   The worklog.
   * @param array<string, array<int|string, \Drupal\Core\Entity\ContentEntityInterface>> $references
   *   Readable entities from references().
   * @param bool $omitted
   *   Set to TRUE when a reference is unreadable.
   *
   * @return array<string, mixed>
   *   The row.
   */
  private function worklogRow(Worklog $entry, array $references, bool &$omitted): array {
    $row = [
      'id' => $entry->uuid(),
      'version' => $entry->version(),
      'work_date' => $entry->get('work_date')->value,
      'state' => $entry->get('state')->value,
      'duration_seconds' => (int) $entry->get('duration_seconds')->value,
      'description' => $entry->get('description')->value,
      'source_keys' => array_column($entry->get('source_keys')->getValue(), 'value'),
    ];
    foreach ($references as $key => $readable) {
      $id = $entry->get(self::field($key))->target_id;
      $entity = $readable[$id] ?? NULL;
      $omitted = $omitted || ($id !== NULL && $entity === NULL);
      $row[$key] = $entity?->uuid();
    }
    return $row;
  }

  /**
   * Batch-loads only readable context; never widens assignment access.
   *
   * @param array<int|string, \Drupal\bb_track\Entity\Worklog> $entries
   *   The worklogs.
   *
   * @return array<string, array<int|string, \Drupal\Core\Entity\ContentEntityInterface>>
   *   Readable entities keyed by row key, then id.
   */
  private function references(array $entries): array {
    $references = [];
    foreach (self::REFERENCES as $key => $type) {
      $ids = [];
      foreach ($entries as $entry) {
        $id = $entry->get(self::field($key))->target_id;
        if ($id !== NULL) {
          $ids[] = $id;
        }
      }
      /** @var array<int|string, \Drupal\Core\Entity\ContentEntityInterface> $entities */
      $entities = $this->entities->getStorage($type)->loadMultiple(array_unique($ids));
      $references[$key] = array_filter($entities, fn(EntityInterface $entity) => $entity->access('view', $this->currentUser));
    }
    return $references;
  }

  /**
   * The worklog field behind a row key.
   */
  private static function field(string $key): string {
    return $key === 'account' ? 'account_id' : $key;
  }

}
