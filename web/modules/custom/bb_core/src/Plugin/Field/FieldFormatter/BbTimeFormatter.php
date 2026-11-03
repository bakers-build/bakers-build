<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Time\BbDate;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A timestamp as the product `<time datetime title>`, through BbDate.
 */
#[FieldFormatter(
  id: 'bb_time',
  label: new TranslatableMarkup('Product time'),
  description: new TranslatableMarkup('Relative under seven days, else an absolute date, as a bb_theme:time element.'),
  field_types: ['created', 'changed', 'timestamp'],
)]
final class BbTimeFormatter extends FormatterBase {

  /**
   * The product time formatter.
   */
  private BbDate $date;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = new static(
      $plugin_id,
      $plugin_definition,
      $configuration['field_definition'],
      $configuration['settings'],
      $configuration['label'],
      $configuration['view_mode'],
      $configuration['third_party_settings'],
    );
    $instance->date = $container->get(BbDate::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public static function defaultSettings(): array {
    return ['date_only' => FALSE] + parent::defaultSettings();
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form['date_only'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Date only'),
      '#description' => $this->t('A calendar date such as "6 Jan", never relative.'),
      '#default_value' => $this->getSetting('date_only'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsSummary(): array {
    return $this->getSetting('date_only') ? [$this->t('Date only')] : [];
  }

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $elements = [];
    foreach ($items as $delta => $item) {
      $timestamp = (int) $item->get('value')->getValue();
      if ($timestamp > 0) {
        $elements[$delta] = $this->getSetting('date_only') ? $this->date->dateElement($timestamp) : $this->date->time($timestamp);
      }
    }
    return $elements;
  }

}
