<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * Renders a state_machine state as its human-readable label.
 *
 * The state_machine module only ships a transition-form formatter (buttons),
 * which is unusable both in the ticket's default view display and in a Views
 * table cell. This formatter outputs the plain state label (e.g. "Coding") so
 * the state can be shown as a read-only, sortable value.
 */
#[FieldFormatter(
  id: 'bb_state_label',
  label: new TranslatableMarkup('State label'),
  field_types: ['state'],
)]
final class StateLabelFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $elements = [];
    foreach ($items as $delta => $item) {
      if (!$item instanceof StateItemInterface) {
        continue;
      }
      $elements[$delta] = [
        '#plain_text' => $item->getLabel() ?? $item->getId(),
      ];
    }
    return $elements;
  }

}
