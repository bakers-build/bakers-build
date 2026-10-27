<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Period;

/**
 * One resolved calendar period with its grouping and comparison period.
 *
 * The phpmd suppression keeps to() paired with from().
 *
 * @SuppressWarnings("PHPMD.ShortMethodName")
 */
final readonly class PeriodRange {

  /**
   * Constructs a resolved period.
   *
   * @param string $kind
   *   The period kind: week, month, quarter, year, all or custom.
   * @param string $start
   *   The first day, `Y-m-d` UTC.
   * @param string $end
   *   The last day, `Y-m-d` UTC, inclusive.
   * @param string $label
   *   The human label of the period.
   * @param string $grouping
   *   The bucket size: day, week, month or quarter.
   * @param bool $current
   *   Whether the period contains today.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange|null $comparison
   *   The comparison period, NULL for All time.
   */
  public function __construct(
    public string $kind,
    public string $start,
    public string $end,
    public string $label,
    public string $grouping,
    public bool $current,
    private ?PeriodRange $comparison = NULL,
  ) {}

  /**
   * The first second of the period.
   */
  public function from(): int {
    return self::timestamp($this->start);
  }

  /**
   * The last second of the period.
   */
  public function to(): int {
    return self::timestamp($this->end) + 86399;
  }

  /**
   * The comparison period with the same grouping, NULL for All time.
   */
  public function comparisonRange(): ?PeriodRange {
    return $this->comparison;
  }

  /**
   * Serializes the period for the figure payload.
   *
   * @return array{kind: string, start: string, end: string, label: string, grouping: string, current: bool, comparison: array{start: string, end: string, label: string}|null}
   *   The period payload.
   */
  public function toArray(): array {
    return [
      'kind' => $this->kind,
      'start' => $this->start,
      'end' => $this->end,
      'label' => $this->label,
      'grouping' => $this->grouping,
      'current' => $this->current,
      'comparison' => $this->comparison === NULL ? NULL : [
        'start' => $this->comparison->start,
        'end' => $this->comparison->end,
        'label' => $this->comparison->label,
      ],
    ];
  }

  /**
   * Midnight UTC of a `Y-m-d` day.
   */
  private static function timestamp(string $day): int {
    return (new \DateTimeImmutable($day, new \DateTimeZone('UTC')))->getTimestamp();
  }

}
