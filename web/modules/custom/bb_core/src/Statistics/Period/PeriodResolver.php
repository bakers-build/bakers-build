<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Period;

/**
 * Turns the selected period filter into a calendar-aligned UTC range.
 *
 * Unsupported or incomplete selections never fail: an old preset such as
 * `365`, an impossible date or an unusable custom range (reversed, before
 * 1970 or longer than 10 years) falls back to the default kind anchored on
 * today, so an old bookmark still opens.
 */
final class PeriodResolver {

  public const KINDS = ['week', 'month', 'quarter', 'year', 'all', 'custom'];

  /**
   * Request keys that travel with the `period` filter.
   */
  public const COMPANIONS = ['date', 'start', 'end'];

  /**
   * Resolves the selection.
   *
   * @param array<string, string> $selected
   *   The `period` kind and its `date`, `start` and `end` companions.
   * @param string $defaultKind
   *   The configured default kind.
   * @param int $now
   *   The evaluation timestamp.
   * @param \Closure(): ?int $earliest
   *   Supplies the earliest measured record; called for All time only.
   */
  public function resolve(array $selected, string $defaultKind, int $now, \Closure $earliest): PeriodRange {
    $utc = new \DateTimeZone('UTC');
    $today = (new \DateTimeImmutable('@' . $now))->setTimezone($utc)->setTime(0, 0);
    if (!in_array($defaultKind, self::KINDS, TRUE) || in_array($defaultKind, ['all', 'custom'], TRUE)) {
      $defaultKind = 'week';
    }

    $kind = (string) ($selected['period'] ?? $defaultKind);
    if (!in_array($kind, self::KINDS, TRUE)) {
      $kind = $defaultKind;
    }

    if ($kind === 'custom') {
      $start = self::day($selected['start'] ?? NULL);
      $end = self::day($selected['end'] ?? NULL);
      return $start !== NULL && $end !== NULL && self::bounded($start, $end)
        ? $this->custom($start, $end, $today)
        : $this->calendar($defaultKind, $today, $today);
    }

    if ($kind === 'all') {
      return $this->allTime($earliest(), $today);
    }

    return $this->calendar($kind, self::day($selected['date'] ?? NULL) ?? $today, $today);
  }

  /**
   * All time from the earliest measured day, without comparison.
   *
   * @param int|null $first
   *   The earliest measured record, NULL when nothing was measured.
   * @param \DateTimeImmutable $today
   *   Midnight UTC of today.
   */
  private function allTime(?int $first, \DateTimeImmutable $today): PeriodRange {
    $start = $first === NULL ? $today : (new \DateTimeImmutable('@' . $first))->setTimezone(new \DateTimeZone('UTC'))->setTime(0, 0);
    $start = min($start, $today);
    $grouping = $today >= $start->modify('+2 years') ? 'quarter' : 'month';
    return new PeriodRange('all', $start->format('Y-m-d'), $today->format('Y-m-d'), 'All time', $grouping, TRUE);
  }

  /**
   * A week, month, quarter or year containing the anchor, with comparison.
   */
  private function calendar(string $kind, \DateTimeImmutable $anchor, \DateTimeImmutable $today): PeriodRange {
    $start = self::calendarStart($kind, $anchor);
    $previous = match ($kind) {
      'week' => $start->modify('-1 week'),
      'month' => $start->modify('-1 month'),
      'quarter' => $start->modify('-3 months'),
      default => $start->modify('-1 year'),
    };
    $grouping = match ($kind) {
      'quarter' => 'week',
      'year' => 'month',
      default => 'day',
    };
    $comparison = self::calendarRange($kind, $previous, $grouping, $today);
    return self::calendarRange($kind, $start, $grouping, $today, $comparison);
  }

  /**
   * A custom range with the same number of days directly before it.
   */
  private function custom(\DateTimeImmutable $start, \DateTimeImmutable $end, \DateTimeImmutable $today): PeriodRange {
    $days = (int) $start->diff($end)->days + 1;
    $grouping = match (TRUE) {
      $days <= 31 => 'day',
      $end < $start->modify('+6 months') => 'week',
      $end < $start->modify('+2 years') => 'month',
      default => 'quarter',
    };
    $comparison = self::customRange($start->modify("-$days days"), $start->modify('-1 day'), $grouping, $today);
    return self::customRange($start, $end, $grouping, $today, $comparison);
  }

  /**
   * Builds a calendar period starting on its first day.
   */
  private static function calendarRange(string $kind, \DateTimeImmutable $start, string $grouping, \DateTimeImmutable $today, ?PeriodRange $comparison = NULL): PeriodRange {
    $end = match ($kind) {
      'week' => $start->modify('+6 days'),
      'month' => $start->modify('last day of this month'),
      'quarter' => $start->modify('+2 months')->modify('last day of this month'),
      default => $start->setDate((int) $start->format('Y'), 12, 31),
    };
    $label = match ($kind) {
      'week' => $start->format('\WW o'),
      'month' => $start->format('M Y'),
      'quarter' => sprintf('Q%d %s', intdiv((int) $start->format('n') - 1, 3) + 1, $start->format('Y')),
      default => $start->format('Y'),
    };
    return new PeriodRange($kind, $start->format('Y-m-d'), $end->format('Y-m-d'), $label, $grouping, $start <= $today && $today <= $end, $comparison);
  }

  /**
   * Builds a custom period.
   */
  private static function customRange(\DateTimeImmutable $start, \DateTimeImmutable $end, string $grouping, \DateTimeImmutable $today, ?PeriodRange $comparison = NULL): PeriodRange {
    $label = $start->format('Y') === $end->format('Y')
      ? $start->format('j M') . ' – ' . $end->format('j M Y')
      : $start->format('j M Y') . ' – ' . $end->format('j M Y');
    return new PeriodRange('custom', $start->format('Y-m-d'), $end->format('Y-m-d'), $label, $grouping, $start <= $today && $today <= $end, $comparison);
  }

  /**
   * The first day of the calendar period containing the anchor.
   */
  private static function calendarStart(string $kind, \DateTimeImmutable $anchor): \DateTimeImmutable {
    $year = (int) $anchor->format('Y');
    return match ($kind) {
      'week' => $anchor->modify('monday this week'),
      'month' => $anchor->modify('first day of this month'),
      'quarter' => $anchor->setDate($year, intdiv((int) $anchor->format('n') - 1, 3) * 3 + 1, 1),
      default => $anchor->setDate($year, 1, 1),
    };
  }

  /**
   * Whether a custom range is ordered, from 1970 on and under 10 years.
   *
   * Every bucket is one query, so an unbounded range is refused.
   */
  private static function bounded(\DateTimeImmutable $start, \DateTimeImmutable $end): bool {
    return $start <= $end && (int) $start->format('Y') >= 1970 && $end < $start->modify('+10 years');
  }

  /**
   * Parses a strict `Y-m-d` day, NULL when absent or not a real date.
   */
  private static function day(?string $value): ?\DateTimeImmutable {
    if ($value === NULL || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts) !== 1
      || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
      return NULL;
    }
    return new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
  }

}
