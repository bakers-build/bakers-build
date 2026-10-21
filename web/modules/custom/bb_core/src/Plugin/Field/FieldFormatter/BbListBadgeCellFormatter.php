<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\Form\OptGroup;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\TypedData\OptionsProviderInterface;

/**
 * A list field's chosen value as a badge, reading the field's own label.
 *
 * The label comes from the field's options provider, as core's
 * `list_default` asks it, so there is no second vocabulary; an unknown value
 * falls back to the raw one. The tone is always `neutral`: badge tones are a
 * status vocabulary, and an arbitrary list value is not a status.
 */
#[FieldFormatter(
  id: 'bb_list_badge_cell',
  label: new TranslatableMarkup('Table cell: list value as badge'),
  description: new TranslatableMarkup("The chosen value's own label as a neutral badge, in a bb_theme:table cell."),
  field_types: ['list_string', 'list_integer', 'list_float'],
)]
final class BbListBadgeCellFormatter extends FormatterBase {

  use TicketCellRenderTrait;

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $options = $this->allowedValues($items);
    $elements = [];
    foreach ($items as $delta => $item) {
      $value = (string) $item->get('value')->getValue();
      if ($value === '') {
        continue;
      }
      $elements[$delta] = $this->cellElement([
        'kind' => 'badge',
        'label' => (string) ($options[$value] ?? $value),
        'tone' => 'neutral',
      ]);
    }
    return $elements;
  }

  /**
   * The field's allowed values, keyed by the value the column stores.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The item list.
   *
   * @return array<string, mixed>
   *   Value => label.
   */
  private function allowedValues(FieldItemListInterface $items): array {
    $provider = $items->getFieldDefinition()
      ->getFieldStorageDefinition()
      ->getOptionsProvider('value', $items->getEntity());

    return $provider instanceof OptionsProviderInterface
      ? OptGroup::flattenOptions($provider->getPossibleOptions())
      : [];
  }

}
