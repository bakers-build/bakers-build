<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The identifier column: the route link to the record, in the machine face.
 *
 * The row's visible affordance: a `<tr>` cannot be wrapped in an anchor, so a
 * reachable row links from its own column (`rows[].url` stays the
 * machine-readable target). `mono` because an identifier is matched character
 * by character, not read.
 */
#[FieldFormatter(
  id: 'bb_ticket_identifier_cell',
  label: new TranslatableMarkup('Table cell: identifier link'),
  description: new TranslatableMarkup("The record's identifier as a monospaced route link, in a bb_theme:table cell."),
  field_types: ['string'],
)]
final class TicketIdentifierCellFormatter extends FormatterBase {

  use TicketCellRenderTrait;

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $entity = $items->getEntity();
    if ($entity->isNew()) {
      // No canonical route exists for an unsaved record, and a link to `#`
      // would be an affordance that goes nowhere.
      return [];
    }
    $url = $entity->toUrl()->toString();

    $elements = [];
    foreach ($items as $delta => $item) {
      $value = (string) $item->get('value')->getValue();
      if ($value === '') {
        continue;
      }
      $elements[$delta] = $this->cellElement([
        'kind' => 'link',
        'value' => $value,
        'url' => $url,
        'mono' => TRUE,
      ]);
    }
    return $elements;
  }

}
