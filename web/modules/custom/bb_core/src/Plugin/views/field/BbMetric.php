<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Plugin\views\BbMetricNameTrait;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\NumericField;

/**
 * Renders a bb_metric value, pinned to a configurable metric name.
 *
 * Type-level (attached by bb_core_views_data_alter to every bb_metric
 * field's value column), so bb_ticket.metrics now and bb_run.metrics later
 * both get a metric-name-configurable, aggregatable value column.
 */
#[ViewsField('bb_metric')]
final class BbMetric extends NumericField {

  use BbMetricNameTrait;

  /**
   * {@inheritdoc}
   */
  protected function defineOptions(): array {
    $options = parent::defineOptions();
    $this->metricNameDefineOptions($options);
    return $options;
  }

  /**
   * {@inheritdoc}
   *
   * @param array $form
   *   The options form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function buildOptionsForm(&$form, FormStateInterface $form_state): void {
    parent::buildOptionsForm($form, $form_state);
    $this->metricNameBuildOptionsForm($form);
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    // Pin first: it repoints tableAlias at the per-name join alias so
    // parent::query() adds the value field against the pinned delta row.
    $this->pinToMetricName();
    parent::query();
  }

}
