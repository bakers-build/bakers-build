<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\bb_core\Inspector\InspectorRows;

/**
 * List helpers for the run overlay mapping shape (lines layout, name/value).
 */
final class BbRunOverlayRows extends InspectorRows {

  /**
   * A named zone whose content is a lines list of pairs.
   *
   * @param string $heading
   *   The zone heading.
   * @param array<int, array<string, mixed>> $items
   *   List items.
   *
   * @return array<string, mixed>
   *   The zone.
   */
  public function namedZone(string $heading, array $items): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
      '#slots' => [
        'heading' => ['#plain_text' => $heading],
        'content' => $this->list($items, 'lines'),
      ],
    ];
  }

  /**
   * A faint-label / mono-value pair.
   *
   * @return array<string, mixed>
   *   A list item.
   */
  public function pair(string $label, string|array $value): array {
    return [
      'cells' => [
        'name' => ['kind' => 'text', 'value' => $label, 'emphasis' => 'faint'],
        'value' => is_array($value) ? $value : ['kind' => 'text', 'value' => $value],
      ],
    ];
  }

  /**
   * A pair, or NULL when the value is empty.
   *
   * @return array<string, mixed>|null
   *   The item, or NULL.
   */
  public function optionalPair(string $label, mixed $value): ?array {
    if ($value === NULL || $value === '') {
      return NULL;
    }
    return $this->pair($label, (string) $value);
  }

}
