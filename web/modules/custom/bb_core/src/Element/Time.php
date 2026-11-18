<?php

declare(strict_types=1);

namespace Drupal\bb_core\Element;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Attribute\FormElement;
use Drupal\Core\Render\Element\Textfield;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * A duration or clock time typed as whole hours or H:MM, checked at the field.
 *
 * A bare whole hour is completed: `8` is `8:00` as a duration and `08:00` as a
 * clock time. The theme's `input--bb-time` does the same when the field loses
 * focus; the value callback covers a request without JS.
 *
 * Properties:
 * - #mode: `duration` (default, hours without upper bound) or `clock` (time of
 *   day, 00:00–23:59).
 * - #minimum, #maximum: the accepted seconds; default 0 and no upper bound.
 * - #format_error, #range_error: the messages, else generic texts.
 */
#[FormElement('bb_time')]
final class Time extends Textfield {

  /**
   * Whole hours, optionally with :MM, per mode.
   */
  private const PATTERNS = [
    'duration' => '/^(\d{1,6})(?::([0-5]\d))?$/',
    'clock' => '/^([01]?\d|2[0-3])(?::([0-5]\d))?$/',
  ];

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The element's default properties.
   */
  public function getInfo(): array {
    return [
      '#theme' => 'input__bb_time',
      '#mode' => 'duration',
      '#minimum' => 0,
      '#maximum' => NULL,
      '#element_validate' => [[static::class, 'validateTime']],
    ] + parent::getInfo();
  }

  /**
   * Seconds of a typed duration, or after midnight of a clock time.
   *
   * @return int|null
   *   The seconds, NULL when the value is not whole hours or H:MM.
   */
  public static function parse(mixed $raw, string $mode = 'duration'): ?int {
    if (!is_string($raw) && !is_int($raw)) {
      return NULL;
    }
    if (!preg_match(self::PATTERNS[$mode], trim((string) $raw), $matches)) {
      return NULL;
    }
    return ((int) $matches[1]) * 3600 + ((int) ($matches[2] ?? 0)) * 60;
  }

  /**
   * The value as shown: H:MM for a duration, HH:MM for a clock time.
   *
   * An invalid value is returned trimmed, as typed, for its error to name.
   */
  public static function normalize(string $value, string $mode = 'duration'): string {
    $value = trim($value);
    $seconds = self::parse($value, $mode);
    if ($seconds === NULL) {
      return $value;
    }
    return sprintf($mode === 'clock' ? '%02d:%02d' : '%d:%02d', intdiv($seconds, 3600), intdiv($seconds % 3600, 60));
  }

  /**
   * {@inheritdoc}
   */
  public static function valueCallback(&$element, $input, FormStateInterface $form_state): mixed {
    $value = parent::valueCallback($element, $input, $form_state);
    return is_string($value) ? self::normalize($value, $element['#mode'] ?? 'duration') : $value;
  }

  /**
   * Sets an invalid or out-of-range value's error on this field.
   */
  public static function validateTime(array &$element, FormStateInterface $form_state): void {
    $value = $element['#value'] ?? '';
    // Form API owns #required.
    if ($value === '') {
      return;
    }
    $mode = $element['#mode'] ?? 'duration';
    $seconds = self::parse($value, $mode);
    if ($seconds === NULL) {
      $form_state->setError($element, $element['#format_error'] ?? ($mode === 'clock'
        ? new TranslatableMarkup('Enter the time as whole hours or HH:MM (24 hours), for example 8 or 14:30.')
        : new TranslatableMarkup('Enter whole hours or hours:minutes, for example 8, 0:30 or 1:15.')));
      return;
    }
    $maximum = $element['#maximum'] ?? NULL;
    if ($seconds < (int) ($element['#minimum'] ?? 0) || ($maximum !== NULL && $seconds > $maximum)) {
      $form_state->setError($element, $element['#range_error'] ?? new TranslatableMarkup('The time is out of range.'));
    }
  }

}
