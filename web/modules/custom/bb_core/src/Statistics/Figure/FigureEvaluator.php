<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Figure;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluator;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementResult;
use Drupal\bb_core\Statistics\Period\PeriodRange;
use Drupal\bb_core\Statistics\Period\PeriodResolver;

/**
 * Composes every referenced measurement into one aligned figure payload.
 */
final class FigureEvaluator {

  private const TIME_TYPES = ['days', 'weeks', 'months', 'quarters'];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly MeasurementEvaluatorInterface $measurementEvaluator,
    private readonly FigureFilterResolver $filterResolver,
    private readonly PeriodResolver $periodResolver,
  ) {}

  /**
   * Evaluates one complete atomic figure.
   *
   * Every figure except rolling `windows` is evaluated on a calendar period
   * and once more on its comparison period, so each measurement carries the
   * previous period's values next to its own.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The configured figure.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   Named entity contexts.
   * @param array<string, string|list<string>> $selectedFilters
   *   Selected filter values, including the period companions; an entity
   *   filter selects a list of UUIDs.
   * @param int $now
   *   The request timestamp.
   * @param list<int>|null $projectBound
   *   The only projects the figure may show, or NULL for no bound; see
   *   FigureDisclosure::projectBound().
   *
   * @return \Drupal\bb_core\Statistics\Figure\FigureResult
   *   The complete figure payload.
   */
  public function evaluate(BbFigureInterface $figure, array $contexts, array $selectedFilters, int $now, ?array $projectBound = NULL): FigureResult {
    $filters = $this->filterResolver->resolve($figure->getFilters(), $selectedFilters, $contexts);
    $contexts = $this->restrict($contexts, $filters, $projectBound);
    $definition = $figure->getCategories();
    $period = NULL;
    if (($definition['type'] ?? NULL) !== 'windows') {
      $period = $this->periodResolver->resolve(
        ['period' => (string) ($filters['period']['value'] ?? '')] + array_filter(array_intersect_key($selectedFilters, array_flip(PeriodResolver::COMPANIONS)), 'is_string'),
        (string) ($figure->getFilters()['period']['default'] ?? 'week'),
        $now,
        fn(): ?int => $this->earliest($figure, $contexts, $now),
      );
      if (isset($filters['period'])) {
        $filters['period']['value'] = $period->kind;
      }
    }
    $effective = $period === NULL ? $definition : $this->rangeDefinition($definition, $period);
    $results = $this->evaluateMeasurements($figure, $contexts, $effective, $now, FALSE);
    $comparison = $period?->comparisonRange();
    $comparisonResults = $comparison === NULL
      ? NULL
      : $this->evaluateMeasurements($figure, $contexts, $this->rangeDefinition($definition, $comparison), $now, TRUE);
    [$categories, $measurements, $hasValue, $tags] = $this->align($figure, $results, ($effective['type'] ?? '') !== 'windows');
    if ($period !== NULL) {
      foreach ($results as $index => $result) {
        $measurements[$index]['comparison'] = $comparisonResults === NULL
          ? NULL
          : $this->alignComparison($categories, $result, $results, $comparisonResults, $index, (string) ($definition['type'] ?? ''), $period);
      }
    }

    $payload = [
      'id' => (string) $figure->id(),
      'label' => (string) $figure->label(),
      'description' => $figure->getDescription(),
      'widget' => $figure->getWidget(),
      'generated' => gmdate('c', $now),
      'filters' => $filters,
    ];
    if ($period !== NULL) {
      $payload['period'] = $period->toArray();
    }
    return new FigureResult($payload + [
      'categories' => $categories,
      'measurements' => $measurements,
      'ratio' => $this->ratio($figure->getRatio(), $categories, $measurements),
      'empty' => [
        'is_empty' => !$hasValue,
        'message' => $hasValue ? NULL : 'No data for this selection.',
      ],
      'cache' => [
        'max_age' => 0,
        'contexts' => ['user.permissions'],
        'tags' => $tags,
      ],
    ]);
  }

  /**
   * Adds the selected entity filters as restriction contexts.
   *
   * A restriction is a list of entities (NULL for "no entity") keyed by the
   * measurement binding it narrows. It is evaluation input only, never part
   * of the disclosure context shape. The loaded entities leave the filter
   * metadata, which is part of the payload.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts.
   * @param array<string, array<string, mixed>> $filters
   *   The resolved filters; entity lists are removed in place.
   * @param list<int>|null $projectBound
   *   The only projects the figure may show, or NULL for no bound.
   *
   * @return array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>>
   *   The contexts plus restrictions.
   */
  private function restrict(array $contexts, array &$filters, ?array $projectBound): array {
    foreach ($filters as $key => $filter) {
      if (($filter['type'] ?? '') !== 'entities') {
        continue;
      }
      $restriction = $filter['entities'];
      if ($filter['unassigned']) {
        $restriction[] = NULL;
      }
      if ($restriction !== []) {
        $contexts[$filter['binding']] = $restriction;
      }
      unset($filters[$key]['entities']);
    }
    if ($projectBound !== NULL) {
      $contexts['project'] = $this->bounded($contexts['project'] ?? NULL, $projectBound);
    }
    return $contexts;
  }

  /**
   * The project context narrowed to the bound; empty matches nothing.
   *
   * @param \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>|null $current
   *   The project context or restriction, if any.
   * @param list<int> $bound
   *   The allowed project ids.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The allowed projects.
   */
  private function bounded(EntityInterface|array|null $current, array $bound): array {
    $projects = match (TRUE) {
      $current === NULL => $this->entityTypeManager->getStorage('bb_project')->loadMultiple($bound),
      is_array($current) => $current,
      default => [$current],
    };
    return array_values(array_filter(
      $projects,
      static fn (?EntityInterface $project): bool => $project !== NULL && in_array((int) $project->id(), $bound, TRUE),
    ));
  }

  /**
   * Bounds the configured category definition by a period.
   *
   * A time axis takes the period's grouping as its bucket type; a dimension
   * or a total keeps its type and is only bounded.
   *
   * @param array<string, mixed> $definition
   *   The configured category definition.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The period to evaluate.
   *
   * @return array<string, mixed>
   *   The effective category definition.
   */
  private function rangeDefinition(array $definition, PeriodRange $period): array {
    if (!in_array($definition['type'] ?? NULL, ['dimension', 'total'], TRUE)) {
      $definition['type'] = $period->grouping . 's';
    }
    $definition['from'] = $period->from();
    $definition['to'] = $period->to();
    return $definition;
  }

  /**
   * The earliest record over every measurement of the figure.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $now
   *   The evaluation timestamp.
   */
  private function earliest(BbFigureInterface $figure, array $contexts, int $now): ?int {
    $storage = $this->entityTypeManager->getStorage('bb_measurement');
    $times = [];
    foreach ($figure->getMeasurements() as $measurementId) {
      $measurement = $storage->load($measurementId);
      if ($measurement instanceof BbMeasurementInterface) {
        $times[] = $this->measurementEvaluator->earliest($measurement, $contexts, $now);
      }
    }
    $times = array_filter($times, static fn(?int $time): bool => $time !== NULL);
    return $times === [] ? NULL : min($times);
  }

  /**
   * Aligns the comparison values of one measurement to the current keys.
   *
   * Time buckets align by position (the i-th comparison bucket belongs to the
   * i-th current key; missing positions are NULL). A dimension and a total
   * align by key, and the current rows decide which keys exist. A series
   * finds its comparison by series id; the remainder series sums every
   * comparison group that is not shown individually.
   *
   * @param array<int, array<string, mixed>> $categories
   *   The aligned current categories.
   * @param \Drupal\bb_core\Statistics\Measurement\MeasurementResult $result
   *   The current measurement result.
   * @param array<\Drupal\bb_core\Statistics\Measurement\MeasurementResult> $results
   *   Every current result, to find the series shown individually.
   * @param array<\Drupal\bb_core\Statistics\Measurement\MeasurementResult> $comparisonResults
   *   Every comparison result.
   * @param int $index
   *   The position of the current result.
   * @param string $configuredType
   *   The configured category type.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The current period.
   *
   * @return array{values: array<string, int|float|null>, labels: array<string, string|null>}
   *   The comparison values and the labels of the matched buckets.
   */
  private function alignComparison(array $categories, MeasurementResult $result, array $results, array $comparisonResults, int $index, string $configuredType, PeriodRange $period): array {
    $default = $result->getValueType() === 'integer' ? 0 : NULL;
    $comparisonLabel = $period->comparisonRange()?->label;
    [$comparisonCategories, $comparisonValues] = $this->comparisonFor($result, $results, $comparisonResults, $index);
    $values = [];
    $labels = [];
    foreach ($categories as $position => $category) {
      $key = $category['key'];
      if (in_array($configuredType, ['dimension', 'total'], TRUE)) {
        $values[$key] = $comparisonValues[$key] ?? $default;
        $labels[$key] = $comparisonLabel;
        continue;
      }
      $matched = $comparisonCategories[$position] ?? NULL;
      $values[$key] = $matched === NULL ? NULL : ($comparisonValues[$matched['key']] ?? $default);
      $labels[$key] = $matched['label'] ?? NULL;
    }
    return ['values' => $values, 'labels' => $labels];
  }

  /**
   * Finds the comparison categories and values belonging to one result.
   *
   * @param \Drupal\bb_core\Statistics\Measurement\MeasurementResult $result
   *   The current measurement result.
   * @param array<\Drupal\bb_core\Statistics\Measurement\MeasurementResult> $results
   *   Every current result.
   * @param array<\Drupal\bb_core\Statistics\Measurement\MeasurementResult> $comparisonResults
   *   Every comparison result.
   * @param int $index
   *   The position of the current result.
   *
   * @return array{0: array<int, array{key: string, label: string, partial?: bool}>, 1: array<string, int|float|null>}
   *   The ordered comparison categories and values keyed by their keys.
   */
  private function comparisonFor(MeasurementResult $result, array $results, array $comparisonResults, int $index): array {
    if (!str_contains($result->getId(), ':')) {
      $comparison = $comparisonResults[$index] ?? NULL;
      return [$comparison?->getCategories() ?? [], $comparison?->getValues() ?? []];
    }
    // shortcut: an empty comparison series list has no bucket labels, so its
    // positions stay NULL; derive the comparison axis if that ever matters.
    $categories = isset($comparisonResults[0]) ? $comparisonResults[0]->getCategories() : [];
    $byId = [];
    foreach ($comparisonResults as $comparison) {
      $byId[$comparison->getId()] = $comparison;
    }
    if (!str_ends_with($result->getId(), ':' . MeasurementEvaluator::SERIES_OTHER)) {
      return [$categories, isset($byId[$result->getId()]) ? $byId[$result->getId()]->getValues() : []];
    }
    $shown = array_map(static fn(MeasurementResult $current): string => $current->getId(), $results);
    $values = [];
    foreach ($byId as $id => $comparison) {
      if (in_array($id, $shown, TRUE)) {
        continue;
      }
      foreach ($comparison->getValues() as $key => $value) {
        $values[$key] = ($values[$key] ?? 0) + $value;
      }
    }
    return [$categories, $values];
  }

  /**
   * Evaluates all measurements referenced by a figure.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param array<string, mixed> $categoryDefinition
   *   The effective category definition.
   * @param int $now
   *   The evaluation timestamp.
   * @param bool $allSeries
   *   Whether a series source returns every group instead of the top ones,
   *   which the comparison needs to find each current series.
   *
   * @return array<\Drupal\bb_core\Statistics\Measurement\MeasurementResult>
   *   The measurement results in configured order.
   */
  private function evaluateMeasurements(
    BbFigureInterface $figure,
    array $contexts,
    array $categoryDefinition,
    int $now,
    bool $allSeries,
  ): array {
    $series = $figure->getSeries();
    if ($series !== []) {
      if (!in_array($categoryDefinition['type'] ?? '', self::TIME_TYPES, TRUE)) {
        throw new \InvalidArgumentException(sprintf('Figure "%s" declares a series source, which requires a time category type.', $figure->id()));
      }
    }

    $storage = $this->entityTypeManager->getStorage('bb_measurement');
    $results = [];
    foreach ($figure->getMeasurements() as $measurementId) {
      $measurement = $storage->load($measurementId);
      if (!$measurement instanceof BbMeasurementInterface) {
        throw new \InvalidArgumentException(sprintf('Figure "%s" references unknown measurement "%s".', $figure->id(), $measurementId));
      }
      if ($series !== []) {
        $dimensionKey = (string) ($series['dimension'] ?? '');
        if (!isset($measurement->getDimensions()[$dimensionKey])) {
          throw new \InvalidArgumentException(sprintf('Measurement "%s" does not define dimension "%s" required by figure "%s" series.', $measurement->id(), $dimensionKey, $figure->id()));
        }
        array_push($results, ...$this->measurementEvaluator->evaluateSeries(
          $measurement,
          $contexts,
          $categoryDefinition,
          $dimensionKey,
          $allSeries ? PHP_INT_MAX : (int) ($series['limit'] ?? 5),
          $now,
        ));
        continue;
      }
      $results[] = $this->measurementEvaluator->evaluate(
        $measurement,
        $contexts,
        $categoryDefinition,
        $now,
      );
    }
    return $results;
  }

  /**
   * Aligns measurement values to the union of their categories.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<\Drupal\bb_core\Statistics\Measurement\MeasurementResult> $results
   *   The evaluated measurement results.
   * @param bool $summable
   *   Whether the categories are disjoint; overlapping windows have no total.
   *
   * @return array{0: array<int, array<string, mixed>>, 1: array<int, array<string, mixed>>, 2: bool, 3: array<string>}
   *   Categories, measurements, the non-empty flag, and cache tags.
   */
  private function align(BbFigureInterface $figure, array $results, bool $summable): array {
    $categoryMap = [];
    foreach ($results as $result) {
      foreach ($result->getCategories() as $category) {
        $categoryMap[$category['key']] ??= $category;
      }
    }

    $categories = array_values($categoryMap);
    $keys = array_keys($categoryMap);
    $measurements = [];
    $hasValue = FALSE;
    $tags = ['config:' . $figure->getConfigDependencyName()];
    $storage = $this->entityTypeManager->getStorage('bb_measurement');
    foreach ($results as $result) {
      $values = [];
      foreach ($keys as $key) {
        $value = $result->getValues()[$key] ?? ($result->getValueType() === 'integer' ? 0 : NULL);
        $values[$key] = $value;
        if ($value !== NULL && (float) $value !== 0.0) {
          $hasValue = TRUE;
        }
      }
      // A series result's id is "<measurement id>:<series key>"; the tag
      // names the underlying measurement config, not the synthetic series id.
      $configId = explode(':', $result->getId(), 2)[0];
      $config = $storage->load($configId);
      $measurement = $result->toArray();
      $measurement['values'] = $values;
      $measurement['total'] = $summable ? $this->total($config, $values) : NULL;
      $measurements[] = $measurement;
      $tags[] = 'config:bb_core.bb_measurement.' . $configId;
    }

    return [
      $categories,
      $measurements,
      $hasValue,
      array_values(array_unique($tags)),
    ];
  }

  /**
   * Sums a measurement's values when they add up to a meaningful total.
   *
   * Point-in-time counts (`open`) and quotients (`divide`) have no meaningful
   * sum over sections; only counts and sums do.
   *
   * @param mixed $config
   *   The loaded measurement configuration.
   * @param array<string, int|float|null> $values
   *   The aligned values.
   */
  private function total(mixed $config, array $values): int|float|null {
    $operation = $config instanceof BbMeasurementInterface ? ($config->getOperation()['type'] ?? '') : '';
    if (!in_array($operation, ['count', 'sum'], TRUE)) {
      return NULL;
    }
    return array_sum(array_filter($values, static fn($value): bool => $value !== NULL));
  }

  /**
   * Divides two measurements' sums over complete categories.
   *
   * Running (`partial`) and period-clipped (`cut`) categories hold incomplete
   * data, so they are left out on purpose.
   *
   * @param array<string, string> $ratio
   *   The figure's ratio configuration, `[]` for none.
   * @param array<int, array<string, mixed>> $categories
   *   The aligned categories.
   * @param array<int, array<string, mixed>> $measurements
   *   The aligned measurements.
   */
  private function ratio(array $ratio, array $categories, array $measurements): ?float {
    if ($ratio === []) {
      return NULL;
    }
    $complete = array_column(array_filter(
      $categories,
      static fn(array $category): bool => empty($category['partial']) && empty($category['cut']),
    ), 'key');
    $byId = array_column($measurements, 'values', 'id');
    $sum = static fn(string $id): float => (float) array_sum(array_intersect_key($byId[$id] ?? [], array_flip($complete)));
    $denominator = $sum($ratio['denominator']);
    return $denominator === 0.0 ? NULL : round($sum($ratio['numerator']) / $denominator, 2);
  }

}
