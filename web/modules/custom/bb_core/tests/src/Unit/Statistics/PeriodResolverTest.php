<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit\Statistics;

use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Calendar periods, their comparison range and grouping are exact.
 */
#[Group('bb_core')]
final class PeriodResolverTest extends UnitTestCase {

  /**
   * Resolves the selected period against a fixed clock.
   *
   * @param array<string, string> $selected
   *   The selected period filter and its companions.
   * @param string $now
   *   The clock, `Y-m-d H:i:s` UTC.
   * @param array<string, mixed> $expected
   *   The expected subset of the serialized range.
   * @param string|null $earliest
   *   The earliest measured record, `Y-m-d H:i:s` UTC.
   */
  #[DataProvider('rangeCases')]
  public function testResolve(array $selected, string $now, array $expected, ?string $earliest = NULL): void {
    $range = (new PeriodResolver())->resolve(
      $selected,
      'week',
      self::ts($now),
      static fn(): ?int => $earliest === NULL ? NULL : self::ts($earliest),
    );
    $actual = $range->toArray();
    foreach ($expected as $key => $value) {
      self::assertSame($value, $actual[$key], $key);
    }
  }

  /**
   * Cases covering every kind, the edges and the fallbacks.
   *
   * @return array<string, array<int, mixed>>
   *   Selected filters, clock, expected subset and optional earliest record.
   */
  public static function rangeCases(): array {
    $now = '2026-10-24 10:00:00';
    return [
      'week' => [['period' => 'week', 'date' => '2026-10-24'], $now, [
        'kind' => 'week',
        'start' => '2026-10-19',
        'end' => '2026-10-25',
        'label' => 'W43 2026',
        'grouping' => 'day',
        'current' => TRUE,
        'comparison' => ['start' => '2026-10-12', 'end' => '2026-10-18', 'label' => 'W42 2026'],
      ],
      ],
      'iso week across the year boundary' => [['period' => 'week', 'date' => '2027-01-01'], $now, [
        'start' => '2026-12-28',
        'end' => '2027-01-03',
        'label' => 'W53 2026',
        'current' => FALSE,
      ],
      ],
      'month comparison ends on the leap day' => [['period' => 'month', 'date' => '2028-03-31'], $now, [
        'start' => '2028-03-01',
        'end' => '2028-03-31',
        'label' => 'Mar 2028',
        'grouping' => 'day',
        'comparison' => ['start' => '2028-02-01', 'end' => '2028-02-29', 'label' => 'Feb 2028'],
      ],
      ],
      'quarter' => [['period' => 'quarter', 'date' => '2026-11-05'], $now, [
        'start' => '2026-10-01',
        'end' => '2026-12-31',
        'label' => 'Q4 2026',
        'grouping' => 'week',
        'comparison' => ['start' => '2026-07-01', 'end' => '2026-09-30', 'label' => 'Q3 2026'],
      ],
      ],
      'year' => [['period' => 'year', 'date' => '2026-06-01'], $now, [
        'start' => '2026-01-01',
        'end' => '2026-12-31',
        'label' => '2026',
        'grouping' => 'month',
        'comparison' => ['start' => '2025-01-01', 'end' => '2025-12-31', 'label' => '2025'],
      ],
      ],
      'custom' => [['period' => 'custom', 'start' => '2026-10-01', 'end' => '2026-10-10'], $now, [
        'kind' => 'custom',
        'start' => '2026-10-01',
        'end' => '2026-10-10',
        'label' => '1 Oct – 10 Oct 2026',
        'grouping' => 'day',
        'comparison' => ['start' => '2026-09-21', 'end' => '2026-09-30', 'label' => '21 Sep – 30 Sep 2026'],
      ],
      ],
      'custom 31 days by day' => [
        ['period' => 'custom', 'start' => '2026-01-01', 'end' => '2026-01-31'],
        $now,
        ['grouping' => 'day'],
      ],
      'custom 32 days by week' => [
        ['period' => 'custom', 'start' => '2026-01-01', 'end' => '2026-02-01'],
        $now,
        ['grouping' => 'week'],
      ],
      'custom under 6 months by week' => [
        ['period' => 'custom', 'start' => '2026-01-01', 'end' => '2026-06-30'],
        $now,
        ['grouping' => 'week'],
      ],
      'custom 6 months by month' => [
        ['period' => 'custom', 'start' => '2026-01-01', 'end' => '2026-07-01'],
        $now,
        ['grouping' => 'month'],
      ],
      'custom under 2 years by month' => [['period' => 'custom', 'start' => '2026-01-01', 'end' => '2027-12-31'], $now, [
        'grouping' => 'month',
        'label' => '1 Jan 2026 – 31 Dec 2027',
      ],
      ],
      'custom 2 years by quarter' => [
        ['period' => 'custom', 'start' => '2026-01-01', 'end' => '2028-01-01'],
        $now,
        ['grouping' => 'quarter'],
      ],
      'all time over 2 years by quarter' => [['period' => 'all'], $now, [
        'kind' => 'all',
        'start' => '2024-10-24',
        'end' => '2026-10-24',
        'label' => 'All time',
        'grouping' => 'quarter',
        'current' => TRUE,
        'comparison' => NULL,
      ], '2024-10-24 13:00:00',
      ],
      'all time under 2 years by month' => [['period' => 'all'], $now, ['grouping' => 'month'], '2024-10-25 13:00:00'],
      'all time without records is today' => [['period' => 'all'], $now, [
        'start' => '2026-10-24',
        'end' => '2026-10-24',
        'grouping' => 'month',
      ],
      ],
      'old preset falls back to the current week' => [['period' => '365'], $now, [
        'kind' => 'week',
        'start' => '2026-10-19',
        'current' => TRUE,
      ],
      ],
      'impossible date falls back to today' => [['period' => 'month', 'date' => '2026-02-30'], $now, [
        'kind' => 'month',
        'start' => '2026-10-01',
      ],
      ],
      'garbage date falls back to today' => [
        ['period' => 'year', 'date' => 'yesterday'],
        $now,
        ['start' => '2026-01-01'],
      ],
      'custom without end falls back' => [['period' => 'custom', 'start' => '2026-10-01'], $now, [
        'kind' => 'week',
        'start' => '2026-10-19',
      ],
      ],
      'custom reversed falls back' => [['period' => 'custom', 'start' => '2026-10-10', 'end' => '2026-10-01'], $now, [
        'kind' => 'week',
        'start' => '2026-10-19',
      ],
      ],
      'custom of 10 years is accepted' => [
        ['period' => 'custom', 'start' => '2016-01-01', 'end' => '2025-12-31'],
        $now,
        ['kind' => 'custom', 'grouping' => 'quarter'],
      ],
      'custom over 10 years falls back' => [
        ['period' => 'custom', 'start' => '2016-01-01', 'end' => '2026-01-01'],
        $now,
        ['kind' => 'week', 'start' => '2026-10-19'],
      ],
      'custom before 1970 falls back' => [
        ['period' => 'custom', 'start' => '1969-12-31', 'end' => '1970-01-10'],
        $now,
        ['kind' => 'week', 'start' => '2026-10-19'],
      ],
      'custom entirely in the future is accepted' => [
        ['period' => 'custom', 'start' => '2030-01-01', 'end' => '2030-12-31'],
        $now,
        ['kind' => 'custom', 'start' => '2030-01-01', 'current' => FALSE],
      ],
      'custom span over 10 years into the future falls back' => [
        ['period' => 'custom', 'start' => '2026-01-01', 'end' => '9999-12-31'],
        $now,
        ['kind' => 'week', 'start' => '2026-10-19'],
      ],
      'missing selection uses the default' => [[], $now, ['kind' => 'week', 'start' => '2026-10-19']],
    ];
  }

  /**
   * The earliest record is only looked up for All time.
   */
  public function testEarliestOnlyForAllTime(): void {
    $calls = new \ArrayObject();
    $earliest = static function () use ($calls): ?int {
      $calls->append(TRUE);
      return NULL;
    };
    $resolver = new PeriodResolver();
    $resolver->resolve(['period' => 'quarter'], 'week', self::ts('2026-10-24 10:00:00'), $earliest);
    self::assertCount(0, $calls);
    $resolver->resolve(['period' => 'all'], 'week', self::ts('2026-10-24 10:00:00'), $earliest);
    self::assertCount(1, $calls);
  }

  /**
   * The range spans whole UTC days.
   */
  public function testTimestamps(): void {
    $range = (new PeriodResolver())->resolve(['period' => 'week', 'date' => '2026-10-24'], 'week', self::ts('2026-10-24 10:00:00'), static fn(): ?int => NULL);
    self::assertSame(self::ts('2026-10-19 00:00:00'), $range->from());
    self::assertSame(self::ts('2026-10-25 23:59:59'), $range->to());
    $comparison = $range->comparisonRange();
    self::assertNotNull($comparison);
    self::assertSame(self::ts('2026-10-12 00:00:00'), $comparison->from());
    self::assertSame('day', $comparison->grouping);
  }

  /**
   * Converts a UTC wall-clock time to a timestamp.
   */
  private static function ts(string $time): int {
    return (new \DateTimeImmutable($time, new \DateTimeZone('UTC')))->getTimestamp();
  }

}
