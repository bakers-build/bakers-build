<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Measurement;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\BbMeasurementInterface;

/**
 * Default evaluator for aggregate and derived measurements.
 */
final class MeasurementEvaluator implements MeasurementEvaluatorInterface {

  private const SERIES_UNATTRIBUTED = '_unattributed';
  private const SERIES_MISSING = '_missing';
  public const SERIES_OTHER = '_other';

  private const WINDOWS = [
    'day' => ['label' => '24 hours', 'seconds' => 86400],
    'week' => ['label' => '7 days', 'seconds' => 604800],
    'month' => ['label' => '30 days', 'seconds' => 2592000],
  ];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly MeasurementQuery $query,
    private readonly ContextBindingResolver $bindingResolver,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function evaluate(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, int $now): MeasurementResult {
    if (($measurement->getOperation()['type'] ?? '') === 'divide') {
      return $this->divide($measurement, $contexts, $categoryDefinition, $now);
    }
    return match ($categoryDefinition['type'] ?? '') {
      'windows' => $this->windows($measurement, $contexts, $categoryDefinition, $now),
      'days', 'weeks', 'months', 'quarters', 'total' => $this->buckets($measurement, $contexts, $categoryDefinition, $now),
      'dimension' => $this->dimension($measurement, $contexts, $categoryDefinition, $now),
      default => throw new \InvalidArgumentException(sprintf('Unsupported measurement category type "%s".', $categoryDefinition['type'] ?? '')),
    };
  }

  /**
   * Evaluates fixed rolling windows.
   */
  private function windows(BbMeasurementInterface $measurement, array $contexts, array $definition, int $now): MeasurementResult {
    $categories = [];
    $values = [];
    foreach ($definition['values'] ?? array_keys(self::WINDOWS) as $key) {
      if (!isset(self::WINDOWS[$key])) {
        throw new \InvalidArgumentException(sprintf('Unknown statistics window "%s".', $key));
      }
      $window = self::WINDOWS[$key];
      $categories[] = ['key' => $key, 'label' => $window['label']];
      $values[$key] = $this->measure($measurement, $contexts, $now - $window['seconds'], $now);
    }
    return $this->result($measurement, $categories, $values);
  }

  /**
   * Evaluates calendar buckets, oldest first; future buckets stay zero.
   */
  private function buckets(BbMeasurementInterface $measurement, array $contexts, array $definition, int $now): MeasurementResult {
    $categories = [];
    $values = [];
    foreach (TimeBuckets::cut($definition, $now) as $bucket) {
      $categories[] = $bucket['category'];
      $values[$bucket['category']['key']] = $bucket['from'] > $now ? 0 : $this->measure($measurement, $contexts, $bucket['from'], $bucket['to']);
    }
    return $this->result($measurement, $categories, $values);
  }

  /**
   * {@inheritdoc}
   */
  public function evaluateSeries(
    BbMeasurementInterface $measurement,
    array $contexts,
    array $categoryDefinition,
    string $dimensionKey,
    int $limit,
    int $now,
  ): array {
    $dimension = $measurement->getDimensions()[$dimensionKey] ?? NULL;
    if ($dimension === NULL) {
      throw new \InvalidArgumentException(sprintf('Measurement "%s" does not define dimension "%s".', $measurement->id(), $dimensionKey));
    }
    $buckets = TimeBuckets::cut($categoryDefinition, $now);
    $categories = array_column($buckets, 'category');

    // One grouped query per bucket; accumulate per-group values keyed by
    // bucket key, and per-group totals to rank and cap afterwards.
    $valuesByGroup = [];
    $totalsByGroup = [];
    foreach ($buckets as $bucket) {
      $bucketKey = $bucket['category']['key'];
      $grouped = $bucket['from'] > $now ? [] : $this->measureGrouped($measurement, $contexts, $bucket['from'], $bucket['to'], $dimension['field']);
      foreach ($grouped as $groupValue => $value) {
        $groupValue = (string) $groupValue;
        $valuesByGroup[$groupValue][$bucketKey] = $value;
        $totalsByGroup[$groupValue] = ($totalsByGroup[$groupValue] ?? 0) + $value;
      }
    }

    $keyLabelByGroup = $this->groupKeysAndLabels($totalsByGroup, $dimension);
    [$valuesByKey, $totalsByKey, $labelByKey] = $this->coalesceGroups(
      $valuesByGroup,
      $totalsByGroup,
      $keyLabelByGroup,
    );

    $rankedKeys = array_keys($totalsByKey);
    usort($rankedKeys, static fn(string $left, string $right): int => $totalsByKey[$right] <=> $totalsByKey[$left]);
    $shown = array_slice($rankedKeys, 0, $limit);
    $remainder = array_slice($rankedKeys, $limit);

    $results = [];
    foreach ($shown as $key) {
      $values = [];
      foreach ($categories as $category) {
        $values[$category['key']] = $valuesByKey[$key][$category['key']] ?? 0;
      }
      $results[] = new MeasurementResult(
        $measurement->id() . ':' . $key,
        $labelByKey[$key],
        $measurement->getValueType(),
        $measurement->getUnit(),
        $categories,
        $values,
      );
    }

    if ($remainder !== []) {
      $values = [];
      foreach ($categories as $category) {
        $sum = 0;
        foreach ($remainder as $key) {
          $sum += $valuesByKey[$key][$category['key']] ?? 0;
        }
        $values[$category['key']] = $sum;
      }
      $results[] = new MeasurementResult(
        $measurement->id() . ':' . self::SERIES_OTHER,
        'Other',
        $measurement->getValueType(),
        $measurement->getUnit(),
        $categories,
        $values,
      );
    }

    return $results;
  }

  /**
   * Merges raw groups that share a mapped series key.
   *
   * @param array<string, array<string, int|float>> $valuesByGroup
   *   Per-bucket values keyed by raw group value.
   * @param array<string, int|float> $totalsByGroup
   *   Period totals keyed by raw group value.
   * @param array<string, array{0: string, 1: string}> $keyLabelByGroup
   *   Mapped key and label pairs keyed by raw group value.
   *
   * @return array{0: array<string, array<string, int|float>>, 1: array<string, int|float>, 2: array<string, string>}
   *   Values, totals and labels keyed by the mapped series key.
   */
  private function coalesceGroups(array $valuesByGroup, array $totalsByGroup, array $keyLabelByGroup): array {
    $valuesByKey = [];
    $totalsByKey = [];
    $labelByKey = [];
    foreach ($totalsByGroup as $groupValue => $total) {
      [$key, $label] = $keyLabelByGroup[$groupValue];
      $labelByKey[$key] = $label;
      $totalsByKey[$key] = ($totalsByKey[$key] ?? 0) + $total;
      foreach ($valuesByGroup[$groupValue] as $bucketKey => $value) {
        $valuesByKey[$key][$bucketKey] = ($valuesByKey[$key][$bucketKey] ?? 0) + $value;
      }
    }
    return [$valuesByKey, $totalsByKey, $labelByKey];
  }

  /**
   * Resolves the display key and label for every raw group value.
   *
   * @param array<string, int|float> $totalsByGroup
   *   Totals keyed by raw group value.
   * @param array<string, mixed> $dimension
   *   The dimension configuration (`field`, optional `entity_type`).
   *
   * @return array<string, array{0: string, 1: string}>
   *   `[key, label]` pairs keyed by raw group value.
   */
  private function groupKeysAndLabels(array $totalsByGroup, array $dimension): array {
    if (($dimension['entity_type'] ?? '') === '') {
      $map = [];
      foreach (array_keys($totalsByGroup) as $groupValue) {
        $map[$groupValue] = $groupValue === ''
          ? [self::SERIES_UNATTRIBUTED, 'Unattributed']
          : [$groupValue, $groupValue];
      }
      return $map;
    }
    $ids = array_values(array_filter(array_keys($totalsByGroup), static fn(string $id): bool => $id !== ''));
    $entities = $this->entityTypeManager->getStorage((string) $dimension['entity_type'])->loadMultiple($ids);
    $map = [];
    foreach (array_keys($totalsByGroup) as $groupValue) {
      if ($groupValue === '') {
        $map[$groupValue] = [self::SERIES_UNATTRIBUTED, 'Unattributed'];
        continue;
      }
      if (!isset($entities[$groupValue])) {
        $map[$groupValue] = [self::SERIES_MISSING, 'Missing'];
        continue;
      }
      $entity = $entities[$groupValue];
      $key = method_exists($entity, 'uuid') ? $entity->uuid() : (string) $entity->id();
      $map[$groupValue] = [$key, (string) $entity->label()];
    }
    return $map;
  }

  /**
   * {@inheritdoc}
   */
  public function earliest(BbMeasurementInterface $measurement, array $contexts, int $now): ?int {
    $operation = $measurement->getOperation();
    if (($operation['type'] ?? '') !== 'divide') {
      return $this->query->earliest($measurement, $contexts, $now);
    }
    $storage = $this->entityTypeManager->getStorage('bb_measurement');
    $times = [];
    foreach ([$operation['numerator'], $operation['denominator']] as $id) {
      $dependency = $storage->load($id);
      if (!$dependency instanceof BbMeasurementInterface) {
        throw new \InvalidArgumentException(sprintf('Derived measurement "%s" references an unknown dependency.', $measurement->id()));
      }
      $times[] = $this->earliest($dependency, $contexts, $now);
    }
    $times = array_filter($times, static fn(?int $time): bool => $time !== NULL);
    return $times === [] ? NULL : min($times);
  }

  /**
   * Evaluates a configured dimension — an entity reference or a scalar value.
   */
  private function dimension(BbMeasurementInterface $measurement, array $contexts, array $definition, int $now): MeasurementResult {
    $dimensionKey = (string) ($definition['dimension'] ?? '');
    $dimension = $measurement->getDimensions()[$dimensionKey] ?? NULL;
    if ($dimension === NULL) {
      throw new \InvalidArgumentException(sprintf('Measurement "%s" does not define dimension "%s".', $measurement->id(), $dimensionKey));
    }
    [$from, $to] = TimeBuckets::range($definition);
    $counts = $from > $now ? [] : $this->measureGrouped($measurement, $contexts, $from, min($to, $now), $dimension['field']);
    $rows = ($dimension['entity_type'] ?? '') === ''
      ? $this->scalarDimensionRows($counts)
      : $this->entityDimensionRows($counts, (string) $dimension['entity_type']);
    if (!empty($definition['fill']) && ($dimension['entity_type'] ?? '') === 'bb_project') {
      $rows = $this->fillProjects($rows, $contexts, ($measurement->getOperation()['type'] ?? '') === 'avg' ? NULL : 0);
    }
    // Rank by measured value, descending, exactly as evaluateSeries() already
    // ranks its series: the row a reader wants first is the biggest one, not
    // the alphabetically first one. The label is the tie-break so equal values
    // keep a stable, readable order.
    usort(
      $rows,
      static fn(array $left, array $right): int =>
        ($right['value'] <=> $left['value']) ?: strnatcasecmp($left['label'], $right['label']),
    );
    $categories = [];
    $values = [];
    foreach ($rows as $row) {
      $categories[] = ['key' => $row['key'], 'label' => $row['label']];
      $values[$row['key']] = $row['value'];
    }
    return $this->result($measurement, $categories, $values);
  }

  /**
   * Adds a row for every project in scope that has no value yet.
   *
   * @param array<int, array{key: string, label: string, value: int|float|null}> $rows
   *   The measured rows.
   * @param array<string, mixed> $contexts
   *   The named contexts and restrictions.
   * @param int|null $fill
   *   The value of a project without data.
   *
   * @return array<int, array{key: string, label: string, value: int|float|null}>
   *   The rows, one per project in scope.
   */
  private function fillProjects(array $rows, array $contexts, ?int $fill): array {
    $rows = array_column($rows, NULL, 'key');
    foreach ($this->entityTypeManager->getStorage('bb_project')->loadMultiple($this->bindingResolver->projectsInScope($contexts)) as $project) {
      $key = (string) $project->uuid();
      $rows[$key] ??= ['key' => $key, 'label' => (string) $project->label(), 'value' => $fill];
    }
    return array_values($rows);
  }

  /**
   * Rows for a scalar dimension: a grouped value is its own key and label.
   *
   * A run's model or state has no entity behind it, so nothing is loaded and
   * nothing can fail to resolve; the empty group is the unattributed row.
   *
   * @param array<string, int|float> $counts
   *   The grouped values keyed by the raw field value.
   *
   * @return array<int, array{key: string, label: string, value: int|float}>
   *   The dimension rows.
   */
  private function scalarDimensionRows(array $counts): array {
    $rows = [];
    foreach ($counts as $value => $count) {
      $value = (string) $value;
      $rows[] = $value === ''
        ? ['key' => 'unattributed', 'label' => 'Unattributed', 'value' => $count]
        : ['key' => $value, 'label' => $value, 'value' => $count];
    }
    return $rows;
  }

  /**
   * Rows for an entity dimension: a grouped id resolves to its uuid and label.
   *
   * @param array<string, int|float> $counts
   *   The grouped values keyed by the referenced entity id.
   * @param string $entityTypeId
   *   The entity type the grouped field references.
   *
   * @return array<int, array{key: string, label: string, value: int|float}>
   *   The dimension rows.
   */
  private function entityDimensionRows(array $counts, string $entityTypeId): array {
    $ids = array_values(array_filter(array_keys($counts), static fn(string $id): bool => $id !== ''));
    $entities = $this->entityTypeManager->getStorage($entityTypeId)->loadMultiple($ids);
    $rows = [];
    foreach ($counts as $id => $count) {
      if ($id === '' || !isset($entities[$id])) {
        $rows[] = ['key' => 'unattributed', 'label' => 'Unattributed', 'value' => $count];
        continue;
      }
      $entity = $entities[$id];
      $key = method_exists($entity, 'uuid') ? $entity->uuid() : (string) $entity->id();
      $rows[] = ['key' => $key, 'label' => (string) $entity->label(), 'value' => $count];
    }
    return $rows;
  }

  /**
   * Evaluates a derived division measurement.
   */
  private function divide(BbMeasurementInterface $measurement, array $contexts, array $definition, int $now): MeasurementResult {
    $operation = $measurement->getOperation();
    $storage = $this->entityTypeManager->getStorage('bb_measurement');
    $numerator = $storage->load($operation['numerator']);
    $denominator = $storage->load($operation['denominator']);
    if (!$numerator instanceof BbMeasurementInterface || !$denominator instanceof BbMeasurementInterface) {
      throw new \InvalidArgumentException(sprintf('Derived measurement "%s" references an unknown dependency.', $measurement->id()));
    }
    $left = $this->evaluate($numerator, $contexts, $definition, $now);
    $right = $this->evaluate($denominator, $contexts, $definition, $now);
    $categories = [];
    foreach (array_merge($left->getCategories(), $right->getCategories()) as $category) {
      $categories[$category['key']] ??= $category;
    }
    $values = [];
    foreach (array_keys($categories) as $key) {
      $value = $left->getValues()[$key] ?? 0;
      $divisor = $right->getValues()[$key] ?? NULL;
      $values[$key] = $divisor === NULL || (float) $divisor === 0.0 ? NULL : round((float) $value / (float) $divisor, 2);
    }
    return $this->result($measurement, array_values($categories), $values);
  }

  /**
   * Measures one window under the measurement's operation.
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
  private function measure(BbMeasurementInterface $measurement, array $contexts, int $from, int $to): int|float|null {
    return match ($measurement->getOperation()['type'] ?? '') {
      'sum' => $this->query->sum($measurement, $contexts, $from, $to),
      'avg' => $this->query->avg($measurement, $contexts, $from, $to),
      'count_over' => $this->query->countOver($measurement, $contexts, $from, $to)[''] ?? 0,
      default => $this->query->count($measurement, $contexts, $from, $to),
    };
  }

  /**
   * Measures one grouped window under the measurement's operation.
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
   * @return array<string, int|float>
   *   Values keyed by source field value.
   */
  private function measureGrouped(BbMeasurementInterface $measurement, array $contexts, int $from, int $to, string $field): array {
    return match ($measurement->getOperation()['type'] ?? '') {
      'sum' => $this->query->sumGrouped($measurement, $contexts, $from, $to, $field),
      'avg' => $this->query->avgGrouped($measurement, $contexts, $from, $to, $field),
      'count_over' => $this->query->countOver($measurement, $contexts, $from, $to, $field),
      default => $this->query->grouped($measurement, $contexts, $from, $to, $field),
    };
  }

  /**
   * Creates a result using metadata from the measurement.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<int, array{key: string, label: string, partial?: bool}> $categories
   *   The ordered categories.
   * @param array<string, int|float|null> $values
   *   The values keyed by category.
   */
  private function result(BbMeasurementInterface $measurement, array $categories, array $values): MeasurementResult {
    return new MeasurementResult(
      (string) $measurement->id(),
      (string) $measurement->label(),
      $measurement->getValueType(),
      $measurement->getUnit(),
      $categories,
      $values,
    );
  }

}
