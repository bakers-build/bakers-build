<?php

declare(strict_types=1);

namespace Drupal\bb_core\Time;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Datetime\FormattedDateDiff;
use Drupal\Core\StringTranslation\StringTranslationTrait;

/**
 * The one product path for displayed times and durations.
 *
 * Under seven days a stamp reads relative ("2 hours ago", "in 3 hours"),
 * older ones absolute ("15 Jun, 13:30"), another year as a date
 * ("15 Jun 2025"). Rendered through `bb_theme:time` as
 * `<time datetime title>`.
 */
final class BbDate {

  use StringTranslationTrait;

  /**
   * Stamps closer than this read relative.
   */
  private const RELATIVE_WINDOW = 7 * 86400;

  /**
   * Constructs the formatter.
   *
   * @param \Drupal\Core\Datetime\DateFormatterInterface $dateFormatter
   *   Formats timestamps in the user's timezone.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   Request time, so relative labels are stable per request.
   */
  public function __construct(
    private readonly DateFormatterInterface $dateFormatter,
    private readonly TimeInterface $time,
  ) {}

  /**
   * The `bb_theme:time` element for a point in time.
   *
   * @param int $timestamp
   *   Unix timestamp.
   * @param bool $dateOnly
   *   TRUE for a calendar date ("6 Jan"), never relative.
   *
   * @return array<string, mixed>
   *   A component render array; a relative label carries its max-age.
   */
  public function time(int $timestamp, bool $dateOnly = FALSE): array {
    $relative = $dateOnly ? NULL : $this->relative($timestamp);
    $element = [
      '#type' => 'component',
      '#component' => 'bb_theme:time',
      '#props' => $this->props($timestamp, $dateOnly, $relative),
    ];
    if ($relative) {
      $element['#cache']['max-age'] = $relative->getCacheMaxAge();
    }
    return $element;
  }

  /**
   * The `time` cell of a `bb_theme:table` or `bb_theme:list` row.
   *
   * shortcut: a cell is plain data and carries no max-age, so a relative
   * label ages until the surrounding render expires; move cells to
   * render arrays if a cached screen shows stale "ago" labels.
   *
   * @param int $timestamp
   *   Unix timestamp.
   * @param bool $dateOnly
   *   TRUE for a calendar date, never relative.
   *
   * @return array<string, string>
   *   The cell: `kind`, `label`, `datetime`, `title`.
   */
  public function cell(int $timestamp, bool $dateOnly = FALSE): array {
    return ['kind' => 'time'] + $this->props($timestamp, $dateOnly, $dateOnly ? NULL : $this->relative($timestamp));
  }

  /**
   * The `bb_theme:time` props.
   *
   * @return array<string, string>
   *   `datetime`, `title` and `label`.
   */
  private function props(int $timestamp, bool $dateOnly, ?FormattedDateDiff $relative): array {
    return [
      'datetime' => $this->dateFormatter->format($timestamp, 'custom', 'c'),
      'title' => $this->dateFormatter->format($timestamp, 'custom', 'D, j M Y, H:i T'),
      'label' => $relative?->getString() ?? ($dateOnly ? $this->date($timestamp) : $this->absolute($timestamp)),
    ];
  }

  /**
   * The display label of a point in time, for plain-text contexts.
   *
   * @param int $timestamp
   *   Unix timestamp.
   *
   * @return string
   *   "2 hours ago", "in 3 hours", "15 Jun, 13:30" or "15 Jun 2025".
   */
  public function label(int $timestamp): string {
    return $this->relative($timestamp)?->getString() ?? $this->absolute($timestamp);
  }

  /**
   * A calendar date: "6 Jan", or "6 Jan 2025" in another year.
   *
   * @param int $timestamp
   *   Unix timestamp.
   *
   * @return string
   *   The date label.
   */
  public function date(int $timestamp): string {
    return $this->dateFormatter->format($timestamp, 'custom', $this->sameYear($timestamp) ? 'j M' : 'j M Y');
  }

  /**
   * A duration: "41s", "36 min", or "1h 10m" past an hour.
   *
   * @param int $seconds
   *   Length in seconds; negative counts as zero.
   *
   * @return string
   *   The duration label.
   */
  public function duration(int $seconds): string {
    $seconds = max(0, $seconds);
    if ($seconds < 60) {
      return $seconds . 's';
    }
    if ($seconds < 3600) {
      return intdiv($seconds, 60) . ' min';
    }
    return intdiv($seconds, 3600) . 'h ' . intdiv($seconds % 3600, 60) . 'm';
  }

  /**
   * The relative label within the window, else NULL.
   */
  private function relative(int $timestamp): ?FormattedDateDiff {
    $now = $this->time->getRequestTime();
    if (abs($timestamp - $now) >= self::RELATIVE_WINDOW) {
      return NULL;
    }
    $options = ['granularity' => 1, 'return_as_object' => TRUE];
    $ahead = $timestamp > $now;
    $diff = $ahead
      ? $this->dateFormatter->formatTimeDiffUntil($timestamp, $options)
      : $this->dateFormatter->formatTimeDiffSince($timestamp, $options);
    $label = $ahead
      ? $this->t('in @interval', ['@interval' => $diff->getString()])
      : $this->t('@interval ago', ['@interval' => $diff->getString()]);
    return new FormattedDateDiff((string) $label, $diff->getCacheMaxAge());
  }

  /**
   * "15 Jun, 13:30", or "15 Jun 2025" in another year.
   */
  private function absolute(int $timestamp): string {
    return $this->dateFormatter->format($timestamp, 'custom', $this->sameYear($timestamp) ? 'j M, H:i' : 'j M Y');
  }

  /**
   * Whether the stamp falls in the request's year, in the user's timezone.
   */
  private function sameYear(int $timestamp): bool {
    return $this->dateFormatter->format($timestamp, 'custom', 'Y') === $this->dateFormatter->format($this->time->getRequestTime(), 'custom', 'Y');
  }

}
