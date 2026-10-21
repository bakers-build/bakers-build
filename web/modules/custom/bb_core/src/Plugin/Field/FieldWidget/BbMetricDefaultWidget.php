<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldWidget;

use Drupal\Core\Field\Attribute\FieldWidget;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\WidgetBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * A four-input widget for a metric: name / value / unit / recorded.
 *
 * The human read/write path; the agent path is JSON:API.
 */
#[FieldWidget(
  id: 'bb_metric_default',
  label: new TranslatableMarkup('Metric fields'),
  field_types: ['bb_metric'],
)]
final class BbMetricDefaultWidget extends WidgetBase {

  /**
   * {@inheritdoc}
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state): array {
    $item = $items[$delta];
    $element['name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Name'),
      '#default_value' => $item->name ?? '',
      '#size' => 24,
      '#maxlength' => 64,
    ];
    $element['value'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Value'),
      '#default_value' => $item->value ?? '',
      '#size' => 12,
    ];
    $element['unit'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Unit'),
      '#default_value' => $item->unit ?? '',
      '#size' => 8,
      '#maxlength' => 32,
    ];
    $element['recorded'] = [
      '#type' => 'number',
      '#title' => $this->t('Recorded'),
      '#default_value' => $item->recorded ?? NULL,
    ];
    return $element;
  }

  /**
   * {@inheritdoc}
   *
   * Casts blank optional inputs to NULL. Core's textfield/number elements
   * submit an untouched field as '', which — unmassaged — flows into the
   * nullable `recorded` int (and the `value`/`unit` columns) and MariaDB strict
   * mode rejects '' for an integer, 500-ing the ordinary edit-and-save.
   * NULL lands as a clean SQL NULL instead.
   */
  public function massageFormValues(array $values, array $form, FormStateInterface $form_state): array {
    foreach ($values as &$item) {
      foreach (['value', 'unit', 'recorded'] as $key) {
        if (isset($item[$key]) && $item[$key] === '') {
          $item[$key] = NULL;
        }
      }
    }
    return $values;
  }

}
