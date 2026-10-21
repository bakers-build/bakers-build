<?php

declare(strict_types=1);

namespace Drupal\bb_core\Reference;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountProxyInterface;

/**
 * Counts the entities that reference given targets, grouped by target.
 *
 * Generic over the counted entity type and its reference field: a project's
 * tickets, a group's projects, or any other reference. Counts are cached for
 * the request per (entity type, field, conditions, current account), so a
 * listing asks once for its whole result set and every later row, field or
 * caller reads from memory. Queries run with access checks, so a reader only
 * counts what they may see.
 */
final class ReferenceCounter {

  /**
   * Counts keyed by cache key, then by target ID.
   *
   * @var array<string, array<int|string, int>>
   */
  private array $counts = [];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AccountProxyInterface $currentUser,
  ) {
  }

  /**
   * How many entities reference each target.
   *
   * @param string $entity_type_id
   *   The counted entity type, e.g. `bb_ticket`.
   * @param string $field
   *   Its reference field, e.g. `project_id`.
   * @param array<int|string> $target_ids
   *   The referenced IDs to count for.
   * @param array<string, bool|int|string|array{operator: 'IS NOT NULL'}> $conditions
   *   Extra conditions on the counted entities: a scalar for equality
   *   (`closed => 0`), or `['operator' => 'IS NOT NULL']` for "is set".
   *
   * @return array<int|string, int>
   *   The count per requested target ID; targets nothing references are 0.
   */
  public function count(string $entity_type_id, string $field, array $target_ids, array $conditions = []): array {
    ksort($conditions);
    $key = implode('|', [$entity_type_id, $field, json_encode($conditions), $this->currentUser->id()]);
    $cached = &$this->counts[$key];
    $cached ??= [];

    $missing = array_values(array_diff($target_ids, array_keys($cached)));
    if ($missing !== []) {
      $query = $this->entityTypeManager->getStorage($entity_type_id)
        ->getAggregateQuery()
        ->accessCheck(TRUE)
        ->condition($field, $missing, 'IN')
        ->groupBy($field)
        ->aggregate('id', 'COUNT');
      foreach ($conditions as $name => $value) {
        is_array($value) ? $query->exists($name) : $query->condition($name, $value);
      }
      $cached += array_fill_keys($missing, 0);
      /** @var array<int, array<string, int|string>> $results */
      $results = $query->execute();
      foreach ($results as $result) {
        $cached[$result[$field]] = (int) $result['id_count'];
      }
    }

    return array_intersect_key($cached, array_flip($target_ids));
  }

}
