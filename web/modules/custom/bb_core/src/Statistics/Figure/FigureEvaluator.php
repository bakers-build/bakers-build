<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Figure;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface;

/**
 * Composes every referenced measurement into one aligned figure payload.
 */
final class FigureEvaluator {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly MeasurementEvaluatorInterface $measurementEvaluator,
    private readonly FigureFilterResolver $filterResolver,
  ) {}

  /**
   * Evaluates one complete atomic figure.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The configured figure.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   Named entity contexts.
   * @param array<string, string> $selectedFilters
   *   Selected filter values.
   * @param int $now
   *   The request timestamp.
   *
   * @return \Drupal\bb_core\Statistics\Figure\FigureResult
   *   The complete figure payload.
   */
  public function evaluate(BbFigureInterface $figure, array $contexts, array $selectedFilters, int $now): FigureResult {
    $filters = $this->filterResolver->resolve($figure->getFilters(), $selectedFilters);
    $categoryDefinition = $this->categoryDefinition($figure, $filters);
    $results = $this->evaluateMeasurements($figure, $contexts, $categoryDefinition, $now);
    [$categories, $measurements, $hasValue, $tags] = $this->align($figure, $results);

    return new FigureResult([
      'id' => (string) $figure->id(),
      'label' => (string) $figure->label(),
      'description' => $figure->getDescription(),
      'widget' => $figure->getWidget(),
      'generated' => gmdate('c', $now),
      'filters' => $filters,
      'categories' => $categories,
      'measurements' => $measurements,
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
   * Applies resolved filters to the category definition.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, array<string, mixed>> $filters
   *   The resolved filters.
   *
   * @return array<string, mixed>
   *   The effective category definition.
   */
  private function categoryDefinition(BbFigureInterface $figure, array $filters): array {
    $definition = $figure->getCategories();
    if (isset($filters['period'])) {
      // The single `period` filter carries three fixed presets — 7, 30 and
      // 365 days — each pairing a period with the granularity that makes
      // sense for it (7d/30d => daily buckets, 365d => monthly buckets). The
      // category machinery selects a category VALUE or PERIOD from a filter,
      // but never a category TYPE, so that mapping is resolved here. The
      // model breakdown (categories.type === 'dimension') has no day/month
      // axis, so only the period bound applies to it; the type stays
      // 'dimension' unconditionally.
      $definition['period'] = $filters['period']['value'];
      if (($definition['type'] ?? NULL) !== 'dimension') {
        $definition['type'] = match ($filters['period']['value']) {
          '365' => 'months',
          default => 'days',
        };
      }
    }
    return $definition;
  }

  /**
   * Evaluates all measurements referenced by a figure.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named context entities.
   * @param array<string, mixed> $categoryDefinition
   *   The effective category definition.
   * @param int $now
   *   The evaluation timestamp.
   *
   * @return array<\Drupal\bb_core\Statistics\Measurement\MeasurementResult>
   *   The measurement results in configured order.
   */
  private function evaluateMeasurements(
    BbFigureInterface $figure,
    array $contexts,
    array $categoryDefinition,
    int $now,
  ): array {
    $series = $figure->getSeries();
    if ($series !== []) {
      if (!in_array($categoryDefinition['type'] ?? '', ['days', 'months'], TRUE)) {
        throw new \InvalidArgumentException(sprintf('Figure "%s" declares a series source, which requires a "days" or "months" category type.', $figure->id()));
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
          (int) ($series['limit'] ?? 5),
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
   *
   * @return array{0: array<int, array<string, mixed>>, 1: array<int, array<string, mixed>>, 2: bool, 3: array<string>}
   *   Categories, measurements, the non-empty flag, and cache tags.
   */
  private function align(BbFigureInterface $figure, array $results): array {
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
    foreach ($results as $result) {
      $values = [];
      foreach ($keys as $key) {
        $value = $result->getValues()[$key] ?? ($result->getValueType() === 'integer' ? 0 : NULL);
        $values[$key] = $value;
        if ($value !== NULL && (float) $value !== 0.0) {
          $hasValue = TRUE;
        }
      }
      $measurement = $result->toArray();
      $measurement['values'] = $values;
      $measurements[] = $measurement;
      // A series result's id is "<measurement id>:<series key>"; the tag
      // names the underlying measurement config, not the synthetic series id.
      $tags[] = 'config:bb_core.bb_measurement.' . strstr($result->getId() . ':', ':', TRUE);
    }

    return [
      $categories,
      $measurements,
      $hasValue,
      array_values(array_unique($tags)),
    ];
  }

}
