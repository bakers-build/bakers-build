<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Measurement;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\bb_core\BbMeasurementInterface;

/**
 * Applies fixed predicates, time bounds, and context bindings to a query.
 */
final class MeasurementQuery {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ContextBindingResolver $bindingResolver,
  ) {}

  /**
   * Counts matching source entities.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
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
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
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
   * Sums a source field over matching entities grouped by one field.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration; `operation.field` is summed.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
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
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
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
   * Applies all configured constraints to a source query.
   *
   * @param \Drupal\Core\Entity\Query\QueryInterface $query
   *   The source entity query.
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named context entities.
   * @param int $from
   *   The inclusive lower timestamp.
   * @param int $to
   *   The inclusive upper timestamp.
   */
  private function constrain(QueryInterface $query, BbMeasurementInterface $measurement, array $contexts, int $from, int $to): bool {
    $source = $measurement->getSource();
    $query->condition($source['time_field'], [$from, $to], 'BETWEEN');
    foreach ($measurement->getPredicates() as $predicate) {
      $query->condition($predicate['field'], $predicate['value'], $predicate['operator']);
    }
    foreach ($contexts as $key => $context) {
      $binding = $measurement->getBindings()[$key] ?? NULL;
      if ($binding === NULL) {
        continue;
      }
      $values = $this->bindingResolver->resolve($binding, $context);
      if ($values === []) {
        return FALSE;
      }
      $query->condition($binding['field'], $values, 'IN');
    }
    return TRUE;
  }

}
