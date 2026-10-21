<?php

declare(strict_types=1);

namespace Drupal\bb_core\Element;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Attribute\FormElement;
use Drupal\Core\Render\Element\FormElementBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Collects picker values through Form API and renders the widget children.
 */
#[FormElement('bb_picker_value')]
final class PickerValue extends FormElementBase {

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The element's default properties.
   */
  public function getInfo(): array {
    return [
      '#input' => TRUE,
      '#theme_wrappers' => ['form_element'],
      // Always a LIST, never a bare scalar, so a widget's
      // `massageFormValues(array $values, …)` — core's own signature — is
      // honest for a single-valued field as well as a multi-valued one.
      '#default_value' => [],
      '#value_callback' => [static::class, 'valueCallback'],
      '#element_validate' => [[static::class, 'validateInput']],
    ];
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $element
   *   The element.
   * @param mixed $input
   *   `FALSE`, `NULL`, or the raw submitted input. See above.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<int, string>
   *   The submitted values, in submission order, with empties dropped.
   */
  public static function valueCallback(&$element, $input, FormStateInterface $form_state): array {
    if ($input === FALSE) {
      $default = $element['#default_value'] ?? [];
      return is_array($default) ? array_values(array_map(strval(...), $default)) : [(string) $default];
    }
    if ($input === NULL) {
      return [];
    }
    $list = is_array($input) ? array_values($input) : [$input];
    foreach ($list as $item) {
      if (!is_scalar($item)) {
        $element['#invalid_picker_input'] = TRUE;
      }
    }
    return array_values(array_filter(
      array_map(static fn (mixed $item): string => is_scalar($item) ? (string) $item : '', $list),
      static fn (string $item): bool => $item !== '',
    ));
  }

  /**
   * Rejects malformed structures before entity persistence can clear a field.
   */
  public static function validateInput(array &$element, FormStateInterface $form_state): void {
    if (!empty($element['#invalid_picker_input'])) {
      $form_state->setError($element, new TranslatableMarkup('The selection has an invalid format.'));
    }
  }

}
