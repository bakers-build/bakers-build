<?php

declare(strict_types=1);

namespace Drupal\bb_core\Time;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Datetime\FormattedDateDiff;
use Drupal\Core\StringTranslation\StringTranslationTrait;

/**
 * Product date display: named absolute format, and relative ago/hence.
 *
 * `normal` is the Drupal date format. Relative time is TimeDiff, not a
 * date-format pattern.
 */
final class BbDate {

  use StringTranslationTrait;

  /**
   * The product absolute date format id.
   */
  public const NORMAL = 'normal';

  /**
   * Constructs the formatter.
   *
   * @param \Drupal\Core\Datetime\DateFormatterInterface $dateFormatter
   *   Formats absolute timestamps through the `normal` date format.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   Request time, so ago versus hence is stable per request.
   */
  public function __construct(
    private readonly DateFormatterInterface $dateFormatter,
    private readonly TimeInterface $time,
  ) {}

  /**
   * Absolute timestamp in the product `normal` format.
   *
   * @param int $timestamp
   *   Unix timestamp.
   *
   * @return string
   *   A value such as "30 Jun 2026, 15:50".
   */
  public function normal(int $timestamp): string {
    return $this->dateFormatter->format($timestamp, self::NORMAL);
  }

  /**
   * Relative timestamp: "@interval ago" in the past, "@interval hence" ahead.
   *
   * @param int $timestamp
   *   Unix timestamp.
   *
   * @return string
   *   A value such as "2 hours ago" or "9 minutes hence".
   */
  public function ago(int $timestamp): string {
    $options = ['granularity' => 1];
    if ($timestamp > $this->time->getRequestTime()) {
      return (string) $this->t('@interval hence', [
        '@interval' => $this->interval(
          $this->dateFormatter->formatTimeDiffUntil($timestamp, $options),
        ),
      ]);
    }
    return (string) $this->t('@interval ago', [
      '@interval' => $this->interval(
        $this->dateFormatter->formatTimeDiffSince($timestamp, $options),
      ),
    ]);
  }

  /**
   * The printable interval from a TimeDiff result.
   *
   * @param \Drupal\Core\Datetime\FormattedDateDiff|string $diff
   *   Cacheable diff object or already-plain string.
   *
   * @return string
   *   The interval text.
   */
  private function interval(FormattedDateDiff|string $diff): string {
    return $diff instanceof FormattedDateDiff ? $diff->getString() : $diff;
  }

}
