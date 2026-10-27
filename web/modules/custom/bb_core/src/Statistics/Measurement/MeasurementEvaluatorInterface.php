<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Measurement;

use Drupal\bb_core\BbMeasurementInterface;

/**
 * Evaluates reusable measurements for one context and category definition.
 */
interface MeasurementEvaluatorInterface {

  /**
   * Evaluates one measurement for a context and category definition.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param array<string, mixed> $categoryDefinition
   *   The category configuration.
   * @param int $now
   *   The evaluation timestamp.
   */
  public function evaluate(BbMeasurementInterface $measurement, array $contexts, array $categoryDefinition, int $now): MeasurementResult;

  /**
   * Evaluates one measurement expanded into one series per dimension value.
   *
   * Crosses a calendar time axis with a dimension: one grouped query
   * per bucket, ranked by period total, capped at `$limit` individually shown
   * series plus one remainder series summing everything past the cap.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration; must declare `$dimensionKey`.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param array<string, mixed> $categoryDefinition
   *   The category configuration; `type` must be `days`, `weeks`, `months`
   *   or `quarters`, with an inclusive `from`/`to` range.
   * @param string $dimensionKey
   *   The dimension key to expand into series.
   * @param int $limit
   *   The number of series shown individually before folding into `Other`.
   * @param int $now
   *   The evaluation timestamp.
   *
   * @return array<int, \Drupal\bb_core\Statistics\Measurement\MeasurementResult>
   *   One result per series, ranked by period total, capped at `$limit` plus
   *   one remainder series. Each result's id is
   *   `<measurement id>:<series key>`, the series key being the dimension's
   *   own group key or one of the synthetic remainder keys.
   */
  public function evaluateSeries(
    BbMeasurementInterface $measurement,
    array $contexts,
    array $categoryDefinition,
    string $dimensionKey,
    int $limit,
    int $now,
  ): array;

  /**
   * Finds the earliest measured record up to now.
   *
   * A derived division takes the earlier record of its two sides.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement configuration.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param int $now
   *   The evaluation timestamp.
   *
   * @return int|null
   *   The earliest source time, NULL when nothing was measured.
   */
  public function earliest(BbMeasurementInterface $measurement, array $contexts, int $now): ?int;

}
