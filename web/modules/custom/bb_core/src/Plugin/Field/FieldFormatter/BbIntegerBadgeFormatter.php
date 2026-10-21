<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;

/**
 * An integer as a small icon badge, matching the listing count cells.
 */
#[FieldFormatter(
  id: 'bb_integer_badge',
  label: new TranslatableMarkup('Integer badge'),
  description: new TranslatableMarkup('The integer as a badge with an icon and a tooltip, for listing right-hand cells.'),
  field_types: ['integer'],
)]
final class BbIntegerBadgeFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   Default formatter settings.
   */
  public static function defaultSettings(): array {
    return [
      'icon' => '',
      'tone' => 'neutral',
      'singular' => '@count',
      'plural' => '@count',
    ] + parent::defaultSettings();
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The settings form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The settings form.
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form = parent::settingsForm($form, $form_state);
    $form['icon'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Icon'),
      '#default_value' => $this->getSetting('icon'),
    ];
    $form['tone'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Tone'),
      '#default_value' => $this->getSetting('tone'),
    ];
    $form['singular'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Singular tooltip'),
      '#default_value' => $this->getSetting('singular'),
    ];
    $form['plural'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Plural tooltip'),
      '#default_value' => $this->getSetting('plural'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   One badge per item.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $icon = (string) $this->getSetting('icon');
    $tone = (string) $this->getSetting('tone');
    $elements = [];
    foreach ($items as $delta => $item) {
      $count = (int) $item->get('value')->getValue();
      // phpcs:ignore Drupal.Semantics.FunctionT.NotLiteralString
      $meaning = (string) $this->formatPlural(
        $count,
        (string) $this->getSetting('singular'),
        (string) $this->getSetting('plural'),
      );
      $elements[$delta] = [
        '#type' => 'component',
        '#component' => 'bb_theme:badge',
        '#props' => [
          'label' => (string) $count,
          'icon' => $icon !== '' ? $icon : NULL,
          'tone' => $tone !== '' ? $tone : 'neutral',
          'attributes' => new Attribute([
            'title' => $meaning,
            'role' => 'img',
            'aria-label' => $meaning,
          ]),
        ],
      ];
    }
    return $elements;
  }

}
