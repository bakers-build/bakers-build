<?php

declare(strict_types=1);

namespace Drupal\bb_addon;

/**
 * Maps a message's flat `input` onto Form API elements and back.
 *
 * The rendering table: string → textfield, multiline → textarea, uri → url,
 * enum → select, integer/number → number, boolean → checkbox. Field order is
 * definition order.
 */
final class AddonFormBuilder {

  /**
   * Form API elements for an input, keyed by property name.
   *
   * @param array<string, mixed> $input
   *   The action's input.
   * @param array<string, mixed> $defaults
   *   Prefilled values, e.g. a row action's args.
   *
   * @return array<string, array<string, mixed>>
   *   The elements.
   */
  public function elements(array $input, array $defaults = []): array {
    $required = $input['required'] ?? [];
    $elements = [];
    foreach ($input['properties'] ?? [] as $name => $field) {
      $element = self::element($field) + [
        '#title' => $field['title'] ?? $name,
        '#required' => $field['type'] !== 'boolean'
        && in_array($name, $required, TRUE)
        && !array_key_exists('default', $field),
      ];
      if (isset($field['description'])) {
        $element['#description'] = $field['description'];
      }
      $default = $defaults[$name] ?? $field['default'] ?? NULL;
      if ($default !== NULL) {
        $element['#default_value'] = $default;
      }
      $elements[$name] = $element;
    }
    return $elements;
  }

  /**
   * Submitted values cast to their field types; empty optionals dropped.
   *
   * @param array<string, mixed>|null $input
   *   The action's input, NULL for none.
   * @param array<string, mixed> $submitted
   *   The submitted form values.
   *
   * @return array<string, mixed>
   *   The payload.
   */
  public function values(?array $input, array $submitted): array {
    $values = [];
    foreach ($input['properties'] ?? [] as $name => $field) {
      $value = $submitted[$name] ?? NULL;
      if ($field['type'] !== 'boolean' && ($value === NULL || $value === '')) {
        continue;
      }
      $values[$name] = match ($field['type']) {
        'integer' => (int) $value,
        'number' => (float) $value,
        'boolean' => (bool) $value,
        default => (string) $value,
      };
    }
    return $values;
  }

  /**
   * The element type and its type-specific keys.
   *
   * @param array<string, mixed> $field
   *   The field.
   *
   * @return array<string, mixed>
   *   The partial element.
   */
  private static function element(array $field): array {
    if (isset($field['enum'])) {
      $options = array_map('strval', $field['enum']);
      return ['#type' => 'select', '#options' => array_combine($options, $options)];
    }
    return match ($field['type']) {
      'integer', 'number' => array_filter([
        '#type' => 'number',
        '#step' => $field['type'] === 'integer' ? 1 : 'any',
        '#min' => $field['minimum'] ?? NULL,
        '#max' => $field['maximum'] ?? NULL,
      ], static fn ($v) => $v !== NULL),
      'boolean' => ['#type' => 'checkbox'],
      default => array_filter([
        '#type' => match ($field['format'] ?? NULL) {
          'multiline' => 'textarea',
          'uri' => 'url',
          default => 'textfield',
        },
        '#maxlength' => $field['maxLength'] ?? NULL,
      ], static fn ($v) => $v !== NULL),
    };
  }

}
