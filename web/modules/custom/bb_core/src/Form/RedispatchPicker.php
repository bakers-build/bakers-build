<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The conductor picker of a Re-dispatch confirmation.
 */
final class RedispatchPicker {

  /**
   * The picker element; it opens on the first candidate and posts `conductor`.
   *
   * @param array<int, string> $targets
   *   Candidate conductor labels keyed by id; not empty.
   *
   * @return array<string, mixed>
   *   The `bb_theme:property_pill` render array.
   */
  public static function element(array $targets): array {
    $first = (int) array_key_first($targets);
    $rows = [];
    foreach ($targets as $id => $label) {
      $rows[] = ['value' => (string) $id, 'label' => $label, 'selected' => $id === $first];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:property_pill',
      '#props' => [
        'name' => 'conductor',
        'label' => (string) new TranslatableMarkup('Conductor'),
        'icon' => 'conductor',
        'picker_id' => 'bb-redispatch-conductor',
        'multiple' => FALSE,
        'open' => FALSE,
        'searchable' => count($rows) > 6,
        'value_label' => $targets[$first],
        'values' => [(string) $first],
        'options' => $rows,
      ],
      '#weight' => -5,
    ];
  }

}
