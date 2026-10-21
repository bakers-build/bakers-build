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
 * A list status as a tinted badge with a status dot.
 *
 * Online uses the running tone; offline uses the offline tone. Any other
 * stored value falls back to a quiet neutral badge so an unknown status is
 * still labelled.
 */
#[FieldFormatter(
  id: 'bb_status_badge',
  label: new TranslatableMarkup('Status badge'),
  description: new TranslatableMarkup('Online and offline as a tinted badge with a status dot.'),
  field_types: ['list_string'],
)]
final class BbStatusBadgeFormatter extends FormatterBase {

  /**
   * Stored value → badge tone.
   */
  private const TONES = [
    'online' => 'running',
    'offline' => 'offline',
  ];

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   One badge per item.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $options = $this->allowedValues($items);
    $elements = [];
    foreach ($items as $delta => $item) {
      $value = (string) $item->get('value')->getValue();
      if ($value === '') {
        continue;
      }
      $elements[$delta] = [
        '#type' => 'component',
        '#component' => 'bb_theme:badge',
        '#props' => [
          'label' => (string) ($options[$value] ?? $value),
          'tone' => self::TONES[$value] ?? 'neutral',
          'dot' => TRUE,
        ],
      ];
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
