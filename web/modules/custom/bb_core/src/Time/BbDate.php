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
   *
   * @return array<string, mixed>
   *   A component render array; a relative label carries its max-age.
   */
  public function time(int $timestamp): array {
    $relative = $this->relative($timestamp);
    $element = $this->element($timestamp, $relative?->getString() ?? $this->absolute($timestamp));
    if ($relative) {
      $element['#cache']['max-age'] = $relative->getCacheMaxAge();
    }
    return $element;
  }

  /**
   * The `bb_theme:time` element for an age, relative at any distance.
   *
   * "3 weeks ago" for how old something is, where `time()` would turn
   * absolute after seven days.
   *
   * @param int $timestamp
   *   Unix timestamp.
   *
   * @return array<string, mixed>
   *   A component render array carrying the label's max-age.
   */
  public function age(int $timestamp): array {
    $diff = $this->diff($timestamp);
    $element = $this->element($timestamp, $diff->getString());
    // shortcut: core's one-unit max-age lets "3 weeks ago" lag up to a
    // unit; expire at the next label change once a stale age is reported.
    $element['#cache']['max-age'] = $diff->getCacheMaxAge();
    return $element;
  }

  /**
   * The `bb_theme:time` element for a calendar date ("6 Jan"), never relative.
   *
   * @param int $timestamp
   *   Unix timestamp.
   *
   * @return array<string, mixed>
   *   A component render array.
   */
  public function dateElement(int $timestamp): array {
    return $this->element($timestamp, $this->date($timestamp));
  }

  /**
   * The `time` cell of a `bb_theme:table` or `bb_theme:list` row.
   *
   * @param int $timestamp
   *   Unix timestamp.
   *
   * @return array<string, string>
   *   The cell: `kind`, `label`, `datetime`, `title`.
   */
  public function cell(int $timestamp): array {
    // shortcut: a cell is plain data and carries no max-age, so a relative
    // label ages until the surrounding render expires; move cells to render
    // arrays if a cached screen shows stale "ago" labels.
    return ['kind' => 'time'] + $this->element($timestamp, $this->label($timestamp))['#props'];
  }

  /**
   * The `bb_theme:time` element with a given label.
   *
   * @return array<string, mixed>
   *   The component render array.
   */
  private function element(int $timestamp, string $label): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:time',
      '#props' => [
        'datetime' => $this->dateFormatter->format($timestamp, 'custom', 'c'),
        'title' => $this->dateFormatter->format($timestamp, 'custom', 'D, j M Y, H:i T'),
        'label' => $label,
      ],
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
    return abs($timestamp - $this->time->getRequestTime()) < self::RELATIVE_WINDOW ? $this->diff($timestamp) : NULL;
  }

  /**
   * The relative label: "2 hours ago" or "in 3 hours", with its max-age.
   */
  private function diff(int $timestamp): FormattedDateDiff {
    $now = $this->time->getRequestTime();
    $options = ['granularity' => 1, 'return_as_object' => TRUE];
    $ahead = $timestamp > $now;
    $diff = $ahead
      ? $this->dateFormatter->formatTimeDiffUntil($timestamp, $options)
      : $this->dateFormatter->formatTimeDiffSince($timestamp, $options);
    // `return_as_object` yields an object; the interface still types a string.
    $interval = $diff instanceof FormattedDateDiff ? $diff->getString() : $diff;
    $maxAge = $diff instanceof FormattedDateDiff ? $diff->getCacheMaxAge() : 0;
    $label = $ahead
      ? $this->t('in @interval', ['@interval' => $interval])
      : $this->t('@interval ago', ['@interval' => $interval]);
    return new FormattedDateDiff((string) $label, $maxAge);
  }

  /**
   * The absolute label: "15 Jun, 13:30", or "15 Jun 2025" in another year.
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
