<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Renders each metric as "name: value unit".
 */
#[FieldFormatter(
  id: 'bb_metric_default',
  label: new TranslatableMarkup('Metric name: value unit'),
  field_types: ['bb_metric'],
)]
final class BbMetricDefaultFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $elements = [];
    foreach ($items as $delta => $item) {
      $name = (string) $item->get('name')->getValue();
      $value = (string) $item->get('value')->getValue();
      if (str_contains($value, '.')) {
        $value = rtrim(rtrim($value, '0'), '.');
      }
      $unit_value = (string) $item->get('unit')->getValue();
      $unit = $unit_value !== '' ? ' ' . $unit_value : '';
      $elements[$delta] = ['#plain_text' => sprintf('%s: %s%s', $name, $value, $unit)];
    }
    return $elements;
  }

}
