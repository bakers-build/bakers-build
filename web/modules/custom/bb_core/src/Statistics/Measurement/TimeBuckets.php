<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Measurement;

/**
 * Cuts a time category's range into calendar buckets.
 *
 * Static because it holds no state; a class of its own keeps the bucket
 * arithmetic out of the evaluator's summed complexity.
 *
 * @see \Drupal\bb_core\Statistics\Measurement\MeasurementEvaluator
 */
final class TimeBuckets {

  /**
   * Cuts the calendar buckets of a time category out of its range.
   *
   * Buckets are calendar-aligned and clipped to the range, so a quarter that
   * starts mid-week begins with a short week and the bucket total equals the
   * range total. A bucket's `to` never passes now; a bucket starting after
   * now has `from > now` and is not queried by the callers.
   *
   * @param array<string, mixed> $definition
   *   The category configuration: `type` and the inclusive `from`/`to`.
   * @param int $now
   *   The evaluation timestamp.
   *
   * @return array<int, array{category: array{key: string, label: string, partial?: bool}, from: int, to: int}>
   *   The ordered buckets, oldest first.
   */
  public static function cut(array $definition, int $now): array {
    [$from, $to] = self::range($definition);
    $type = (string) $definition['type'];
    $buckets = [];
    $cursor = new \DateTimeImmutable('@' . $from);
    while ($cursor->getTimestamp() <= $to) {
      $next = self::next($type, $cursor, $to);
      $bucketFrom = $cursor->getTimestamp();
      $bucketTo = min($next->getTimestamp() - 1, $to);
      $category = self::category($type, $cursor);
      if ($bucketFrom <= $now && $now <= $bucketTo) {
        $category['partial'] = TRUE;
      }
      $buckets[] = ['category' => $category, 'from' => $bucketFrom, 'to' => min($bucketTo, $now)];
      $cursor = $next->setTime(0, 0);
    }
    return $buckets;
  }

  /**
   * Reads the inclusive range of a time or dimension category.
   *
   * @param array<string, mixed> $definition
   *   The category configuration.
   *
   * @return array{0: int, 1: int}
   *   The inclusive lower and upper timestamps.
   */
  public static function range(array $definition): array {
    if (!is_int($definition['from'] ?? NULL) || !is_int($definition['to'] ?? NULL)) {
      throw new \InvalidArgumentException(sprintf(
        'The "%s" category requires an integer "from" and "to" range.',
        $definition['type'] ?? '',
      ));
    }
    return [$definition['from'], $definition['to']];
  }

  /**
   * Finds the start of the bucket after the one starting at the cursor.
   *
   * @param string $type
   *   The category type.
   * @param \DateTimeImmutable $cursor
   *   The current bucket start.
   * @param int $to
   *   The inclusive upper timestamp of the range.
   */
  private static function next(string $type, \DateTimeImmutable $cursor, int $to): \DateTimeImmutable {
    return match ($type) {
      'days' => $cursor->modify('+1 day'),
      'weeks' => $cursor->modify('next monday'),
      'months' => $cursor->modify('first day of next month'),
      'quarters' => $cursor->setDate((int) $cursor->format('Y'), (self::quarter($cursor) - 1) * 3 + 4, 1),
      default => new \DateTimeImmutable('@' . ($to + 1)),
    };
  }

  /**
   * Builds the category of the bucket starting at the cursor.
   *
   * @param string $type
   *   The category type.
   * @param \DateTimeImmutable $cursor
   *   The bucket start.
   *
   * @return array{key: string, label: string, partial?: bool}
   *   The bucket category.
   */
  private static function category(string $type, \DateTimeImmutable $cursor): array {
    return match ($type) {
      'days' => ['key' => $cursor->format('Y-m-d'), 'label' => $cursor->format('D j')],
      'weeks' => ['key' => $cursor->format('o-\\WW'), 'label' => $cursor->format('\\WW')],
      'months' => ['key' => $cursor->format('Y-m'), 'label' => $cursor->format('M Y')],
      'quarters' => [
        'key' => sprintf('%s-Q%d', $cursor->format('Y'), self::quarter($cursor)),
        'label' => sprintf('Q%d %s', self::quarter($cursor), $cursor->format('Y')),
      ],
      default => ['key' => 'total', 'label' => 'Total'],
    };
  }

  /**
   * Returns the 1-based quarter of a date.
   *
   * @param \DateTimeImmutable $date
   *   The date.
   */
  private static function quarter(\DateTimeImmutable $date): int {
    return intdiv((int) $date->format('n') - 1, 3) + 1;
  }

}
