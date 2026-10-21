<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Civil dates and bounded durations.
 */
final class WorkTimeRules {

  /**
   * The single shared upper bound for one recorded entry: 1440 minutes.
   */
  public const MAX_ENTRY_SECONDS = 86400;

  /**
   * The shared H:MM duration pattern, hours then minutes.
   */
  public const DURATION_PATTERN = '/^(\d{1,6}):([0-5]\d)$/';

  /**
   * Validates whole-minute bounded duration, distinguishing explicit zero.
   */
  public static function seconds(mixed $value, int $minimum = 60, int $maximum = self::MAX_ENTRY_SECONDS): void {
    if (!is_int($value) || $value < $minimum || $value > $maximum || $value % 60 !== 0) {
      throw new \InvalidArgumentException(sprintf(
        'Duration must be whole minutes between %s and %s.',
        self::format($minimum),
        self::format($maximum),
      ));
    }
  }

  /**
   * Explains why a typed H:MM duration was rejected, format vs. out-of-range.
   */
  public static function durationError(mixed $raw): TranslatableMarkup {
    $value = is_string($raw) || is_int($raw) ? trim((string) $raw) : '';
    return preg_match(self::DURATION_PATTERN, $value)
      ? new TranslatableMarkup('Duration must be between 0:01 and 24:00.')
      : new TranslatableMarkup('Enter duration as hours:minutes, for example 0:30 or 1:15.');
  }

  /**
   * Formats seconds as H:MM for error messages.
   */
  private static function format(int $seconds): string {
    return sprintf('%d:%02d', intdiv($seconds, 3600), intdiv($seconds % 3600, 60));
  }

  /**
   * Rejects normalized invalid dates rather than silently moving work.
   */
  public static function date(mixed $value): string {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
      throw new \InvalidArgumentException('Use a valid civil date.');
    }
    $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$parsed || $parsed->format('Y-m-d') !== $value) {
      throw new \InvalidArgumentException('Use a valid civil date.');
    }
    return $value;
  }

}
