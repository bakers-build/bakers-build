<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The priority column: a badge reading the field's OWN allowed value.
 *
 * The label comes from `options_allowed_values()`, the same source the edit
 * form and the `priority` facet read, so the row and the facet never disagree
 * and a relabel in field storage moves all of them. The first allowed value
 * gets the `critical` tone, so a list starting elsewhere still marks its top.
 */
#[FieldFormatter(
  id: 'bb_ticket_priority_cell',
  label: new TranslatableMarkup('Table cell: allowed-value badge'),
  description: new TranslatableMarkup("The list field's own allowed-value label as a badge, in a bb_theme:table cell."),
  field_types: ['list_integer', 'list_string', 'list_float'],
)]
final class TicketPriorityCellFormatter extends FormatterBase {

  use TicketCellRenderTrait;

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $allowed = options_allowed_values(
      $items->getFieldDefinition()->getFieldStorageDefinition(),
      $items->getEntity(),
    );
    $first = array_key_first($allowed);

    $elements = [];
    foreach ($items as $delta => $item) {
      $value = $item->get('value')->getValue();
      if ($value === NULL || $value === '') {
        continue;
      }
      // An id nothing resolves reads as itself rather than as an em-dash: a
      // value outside the list is a data fault the operator has to see, where
      // an absent value is simply absent and the template dashes it.
      $label = (string) ($allowed[$value] ?? $value);
      $elements[$delta] = $this->cellElement([
        'kind' => 'badge',
        'label' => $label,
        'tone' => (string) $value === (string) $first ? 'critical' : 'neutral',
      ]);
    }
    return $elements;
  }

}
