<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Measurement;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\Sql\SqlEntityStorageInterface;
use Drupal\Core\Entity\Query\ConditionInterface;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\bb_core\BbMeasurementInterface;

/**
 * Applies fixed predicates, time bounds, and context bindings to a query.
 */
final class MeasurementQuery {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ContextBindingResolver $bindingResolver,
    private readonly EntityFieldManagerInterface $entityFieldManager,
    private readonly Connection $database,
  ) {}

  /**
   * Counts matching source entities.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   */
  public function count(BbMeasurementInterface $measurement, array $contexts, int $from, int $to): int {
    $query = $this->entityTypeManager->getStorage($measurement->getSource()['entity_type'])->getQuery()->accessCheck(FALSE);
    if (!$this->constrain($query, $measurement, $contexts, $from, $to)) {
      return 0;
    }
    return (int) $query->count()->execute();
  }

  /**
   * Sums a source field over matching entities.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration; `operation.field` is summed.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   */
  public function sum(BbMeasurementInterface $measurement, array $contexts, int $from, int $to): int {
    $query = $this->entityTypeManager->getStorage($measurement->getSource()['entity_type'])->getAggregateQuery()->accessCheck(FALSE);
    if (!$this->constrain($query, $measurement, $contexts, $from, $to)) {
      return 0;
    }
    $field = (string) ($measurement->getOperation()['field'] ?? '');
    $rows = $query->aggregate($field, 'SUM')->execute();
    $row = is_array($rows) ? reset($rows) : NULL;
    return (int) (is_array($row) ? (reset($row) ?: 0) : 0);
  }

  /**
   * Averages a source field over matching entities.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration; `operation.field` is averaged.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   *
   * @return float|null
   *   The mean, or NULL when no entity carries a value.
   */
  public function avg(BbMeasurementInterface $measurement, array $contexts, int $from, int $to): ?float {
    return $this->averages($measurement, $contexts, $from, $to, NULL)[''] ?? NULL;
  }

  /**
   * Averages a source field over matching entities grouped by one field.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration; `operation.field` is averaged.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   * @param string $field
   *   The source field used for grouping.
   *
   * @return array<string, float>
   *   Means keyed by source field value.
   */
  public function avgGrouped(BbMeasurementInterface $measurement, array $contexts, int $from, int $to, string $field): array {
    return $this->averages($measurement, $contexts, $from, $to, $field);
  }

  /**
   * Averages one field item property per group of matching entities.
   *
   * An entity aggregate query joins a multi-value field once per condition
   * and once per aggregate, so `metrics.name = x` and `AVG(metrics.value)`
   * would pair values of other items. The matching entities are therefore
   * selected first, and the averaged property is read from the field table
   * with the field's own predicates applied to the same item row.
   *
   * @return array<string, float>
   *   Means keyed by group value; '' when ungrouped or unattributed.
   */
  private function averages(BbMeasurementInterface $measurement, array $contexts, int $from, int $to, ?string $groupField): array {
    $entityTypeId = $measurement->getSource()['entity_type'];
    $storage = $this->entityTypeManager->getStorage($entityTypeId);
    $groupOf = $this->groupOfMatches($measurement, $contexts, $from, $to, $groupField);
    if ($groupOf === [] || !$storage instanceof SqlEntityStorageInterface) {
      return [];
    }
    $idKey = (string) $this->entityTypeManager->getDefinition($entityTypeId)->getKey('id');

    [$fieldName, $property] = explode('.', (string) ($measurement->getOperation()['field'] ?? ''), 2) + [1 => 'value'];
    $definition = $this->entityFieldManager->getFieldStorageDefinitions($entityTypeId)[$fieldName];
    $mapping = $storage->getTableMapping();
    $table = $mapping->getFieldTableName($fieldName);
    // A multi-value field lives in its own table keyed by entity_id.
    $entityColumn = in_array('entity_id', $mapping->getAllColumns($table), TRUE) ? 'entity_id' : $idKey;
    $valueColumn = $mapping->getFieldColumnName($definition, $property);
    // shortcut: one IN list over all matching entities; chunk it when a
    // period ever matches tens of thousands of entities.
    $select = $this->database->select($table, 'f')
      ->fields('f', [$entityColumn, $valueColumn])
      ->condition('f.' . $entityColumn, array_keys($groupOf), 'IN')
      ->isNotNull('f.' . $valueColumn);
    foreach ($measurement->getPredicates() as $predicate) {
      if (str_starts_with($predicate['field'], $fieldName . '.')) {
        $column = $mapping->getFieldColumnName($definition, substr($predicate['field'], strlen($fieldName) + 1));
        $select->condition('f.' . $column, $predicate['value'], $predicate['operator']);
      }
    }
    $sums = [];
    $counts = [];
    foreach ($select->execute() as $row) {
      $group = $groupOf[$row->{$entityColumn}];
      $sums[$group] = ($sums[$group] ?? 0.0) + (float) $row->{$valueColumn};
      $counts[$group] = ($counts[$group] ?? 0) + 1;
    }
    $means = [];
    foreach ($sums as $group => $sum) {
      $means[(string) $group] = $sum / $counts[$group];
    }
    return $means;
  }

  /**
   * Counts matching entities with more related entities than a threshold.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration; `operation.related` names the related
   *   entity type and its reference field, `operation.threshold` the count
   *   that must be exceeded. Related entities count regardless of time.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   * @param string|null $groupField
   *   The source field used for grouping, or NULL for one total under ''.
   *
   * @return array<string, int>
   *   Counts keyed by group value.
   */
  public function countOver(BbMeasurementInterface $measurement, array $contexts, int $from, int $to, ?string $groupField = NULL): array {
    $groupOf = $this->groupOfMatches($measurement, $contexts, $from, $to, $groupField);
    if ($groupOf === []) {
      return [];
    }
    $operation = $measurement->getOperation();
    $related = (string) $operation['related']['field'];
    /** @var array<int, array<string, mixed>> $rows */
    $rows = $this->entityTypeManager->getStorage((string) $operation['related']['entity_type'])->getAggregateQuery()
      ->accessCheck(FALSE)
      ->condition($related, array_keys($groupOf), 'IN')
      ->groupBy($related)
      ->conditionAggregate('id', 'COUNT', (int) $operation['threshold'], '>')
      ->execute();
    $counts = [];
    foreach ((array) $rows as $row) {
      $group = $groupOf[$row[$related]] ?? NULL;
      if ($group !== NULL) {
        $counts[$group] = ($counts[$group] ?? 0) + 1;
      }
    }
    return $counts;
  }

  /**
   * Maps every matching source entity to its group value.
   *
   * @return array<int|string, string>
   *   Group values keyed by entity id; '' when ungrouped or unattributed.
   */
  private function groupOfMatches(BbMeasurementInterface $measurement, array $contexts, int $from, int $to, ?string $groupField): array {
    $entityTypeId = $measurement->getSource()['entity_type'];
    $query = $this->entityTypeManager->getStorage($entityTypeId)->getAggregateQuery()->accessCheck(FALSE);
    if (!$this->constrain($query, $measurement, $contexts, $from, $to)) {
      return [];
    }
    $idKey = (string) $this->entityTypeManager->getDefinition($entityTypeId)->getKey('id');
    $query->groupBy($idKey);
    if ($groupField !== NULL) {
      $query->groupBy($groupField);
    }
    /** @var array<int, array<string, mixed>> $rows */
    $rows = (array) $query->execute();
    $groupOf = [];
    foreach ($rows as $row) {
      $id = $row[$idKey];
      unset($row[$idKey]);
      // Grouped by the id itself, the id column is the group value.
      $groupValue = match ($groupField) {
        NULL => NULL,
        $idKey => $id,
        default => reset($row),
      };
      $groupOf[$id] = ($groupValue === NULL || $groupValue === FALSE) ? '' : (string) $groupValue;
    }
    return $groupOf;
  }

  /**
   * Sums a source field over matching entities grouped by one field.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration; `operation.field` is summed.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   * @param string $field
   *   The source field used for grouping.
   *
   * @return array<string, int>
   *   Sums keyed by source field value.
   */
  public function sumGrouped(BbMeasurementInterface $measurement, array $contexts, int $from, int $to, string $field): array {
    $query = $this->entityTypeManager->getStorage($measurement->getSource()['entity_type'])->getAggregateQuery()->accessCheck(FALSE);
    if (!$this->constrain($query, $measurement, $contexts, $from, $to)) {
      return [];
    }
    $summed = (string) ($measurement->getOperation()['field'] ?? '');
    $alias = $summed . '_sum';
    $rows = $query->aggregate($summed, 'SUM')->groupBy($field)->execute();
    $sums = [];
    foreach (is_array($rows) ? $rows : [] as $row) {
      if (!is_array($row)) {
        continue;
      }
      $value = (int) ($row[$alias] ?? 0);
      unset($row[$alias]);
      $groupValue = reset($row);
      $key = ($groupValue === NULL || $groupValue === '') ? '' : (string) $groupValue;
      $sums[$key] = ($sums[$key] ?? 0) + $value;
    }
    return $sums;
  }

  /**
   * Counts matching source entities grouped by one field.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   * @param string $field
   *   The source field used for grouping.
   *
   * @return array<string, int>
   *   Counts keyed by source field value.
   */
  public function grouped(BbMeasurementInterface $measurement, array $contexts, int $from, int $to, string $field): array {
    $query = $this->entityTypeManager->getStorage($measurement->getSource()['entity_type'])->getAggregateQuery()->accessCheck(FALSE);
    if (!$this->constrain($query, $measurement, $contexts, $from, $to)) {
      return [];
    }
    $rows = $query->aggregate('id', 'COUNT')->groupBy($field)->execute();
    $counts = [];
    foreach (is_array($rows) ? $rows : [] as $row) {
      if (!is_array($row)) {
        continue;
      }
      $count = (int) ($row['id_count'] ?? 0);
      unset($row['id_count']);
      $value = reset($row);
      $key = ($value === NULL || $value === '') ? '' : (string) $value;
      $counts[$key] = ($counts[$key] ?? 0) + $count;
    }
    return $counts;
  }

  /**
   * Finds the earliest source time of matching entities up to now.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $now
   *   The inclusive upper timestamp.
   */
  public function earliest(BbMeasurementInterface $measurement, array $contexts, int $now): ?int {
    $query = $this->entityTypeManager->getStorage($measurement->getSource()['entity_type'])->getAggregateQuery()->accessCheck(FALSE);
    if (!$this->constrain($query, $measurement, $contexts, 0, $now)) {
      return NULL;
    }
    $field = (string) $measurement->getSource()['time_field'];
    // An aggregate query returns rows of aliased values, not entity ids.
    /** @var array<int, array<string, mixed>>|int $rows */
    $rows = $query->aggregate($field, 'MIN')->execute();
    $row = is_array($rows) ? reset($rows) : NULL;
    $value = is_array($row) ? reset($row) : NULL;
    return $value === NULL || $value === FALSE ? NULL : (int) $value;
  }

  /**
   * Applies all configured constraints to a source query.
   *
   * @param \Drupal\Core\Entity\Query\QueryInterface $query
   *   The source entity query.
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   */
  private function constrain(QueryInterface $query, BbMeasurementInterface $measurement, array $contexts, int $from, int $to): bool {
    $source = $measurement->getSource();
    $end = $measurement->getOperation()['end_field'] ?? NULL;
    $open = ($measurement->getOperation()['type'] ?? '') === 'open' && is_string($end);
    $query->condition($source['time_field'], $open ? $to : [$from, $to], $open ? '<=' : 'BETWEEN');
    if ($open) {
      // An open count is a point in time: started by $to and not ended by it.
      $query->condition($query->orConditionGroup()->notExists($end)->condition($end, $to, '>'));
    }
    foreach ($measurement->getPredicates() as $predicate) {
      $query->condition($predicate['field'], $predicate['value'], $predicate['operator']);
    }
    return $this->bindContexts($query, $measurement, $contexts);
  }

  /**
   * Narrows a source query by every context the measurement binds.
   *
   * @param \Drupal\Core\Entity\Query\QueryInterface $query
   *   The source entity query.
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities and restriction lists.
   *
   * @return bool
   *   FALSE when a context binds to nothing, so nothing can match.
   */
  private function bindContexts(QueryInterface $query, BbMeasurementInterface $measurement, array $contexts): bool {
    foreach ($contexts as $key => $context) {
      $binding = $measurement->getBindings()[$key] ?? NULL;
      if ($binding === NULL) {
        continue;
      }
      [$values, $none] = $this->bindingResolver->resolveAll($binding, $context);
      if ($values === [] && !$none) {
        return FALSE;
      }
      if ($none) {
        $query->condition($this->orUnbound($query, $binding['field'], $values));
        continue;
      }
      $query->condition($binding['field'], $values, 'IN');
    }
    return TRUE;
  }

  /**
   * Matches the given IDs or no value at all in one field.
   *
   * @param \Drupal\Core\Entity\Query\QueryInterface $query
   *   The source entity query.
   * @param string $field
   *   The bound field.
   * @param list<int|string> $values
   *   The admitted IDs; may be empty.
   */
  private function orUnbound(QueryInterface $query, string $field, array $values): ConditionInterface {
    $either = $query->orConditionGroup()->notExists($field);
    return $values === [] ? $either : $either->condition($field, $values, 'IN');
  }

}
