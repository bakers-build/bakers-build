<?php

declare(strict_types=1);

namespace Drupal\bb_track\Element;

use Drupal\bb_track\Form\WorklogFormLayout;
use Drupal\bb_track\WorkTimeRules;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Attribute\FormElement;
use Drupal\Core\Render\Element\Textfield;

/**
 * A duration typed as whole hours or H:MM, validated at the field.
 *
 * Properties:
 * - #minimum: the smallest accepted seconds, default 60.
 * - #format_error: the message for any invalid value; default
 *   WorkTimeRules::durationError().
 */
#[FormElement('bb_duration')]
final class Duration extends Textfield {

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The element's default properties.
   */
  public function getInfo(): array {
    return [
      '#theme' => 'input__bb_duration',
      '#minimum' => 60,
      '#element_validate' => [[static::class, 'validateDuration']],
    ] + parent::getInfo();
  }

  /**
   * {@inheritdoc}
   *
   * Completes a bare whole hour to H:00, so a rebuild without JS shows it so.
   */
  public static function valueCallback(&$element, $input, FormStateInterface $form_state): mixed {
    $value = parent::valueCallback($element, $input, $form_state);
    if (!is_string($value)) {
      return $value;
    }
    $value = trim($value);
    return preg_match('/^\d{1,6}$/', $value) ? $value . ':00' : $value;
  }

  /**
   * Sets an invalid duration's error on this field.
   */
  public static function validateDuration(array &$element, FormStateInterface $form_state): void {
    $value = $element['#value'] ?? '';
    // Form API owns #required.
    if ($value === '' || WorklogFormLayout::parseDuration($value, (int) $element['#minimum']) !== NULL) {
      return;
    }
    $form_state->setError($element, $element['#format_error'] ?? WorkTimeRules::durationError($value));
  }

}
