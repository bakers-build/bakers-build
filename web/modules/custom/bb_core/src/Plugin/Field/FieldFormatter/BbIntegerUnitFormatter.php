<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The integer followed by a unit, such as "42 s", as plain text.
 */
#[FieldFormatter(
  id: 'bb_integer_unit',
  label: new TranslatableMarkup('Integer with unit'),
  field_types: ['integer'],
)]
final class BbIntegerUnitFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   */
  public static function defaultSettings(): array {
    return ['unit' => ''] + parent::defaultSettings();
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form = parent::settingsForm($form, $form_state);
    $form['unit'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Unit'),
      '#default_value' => $this->getSetting('unit'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   One text per item.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $unit = (string) $this->getSetting('unit');
    $elements = [];
    foreach ($items as $delta => $item) {
      $elements[$delta] = ['#plain_text' => trim($item->get('value')->getValue() . ' ' . $unit)];
    }
    return $elements;
  }

}
