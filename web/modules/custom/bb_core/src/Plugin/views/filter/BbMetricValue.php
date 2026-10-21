<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Plugin\views\BbMetricNameTrait;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\NumericFilter;

/**
 * Numeric filter on a bb_metric value, pinned to a configurable metric name.
 *
 * Type-level: filter the named metric's value (e.g. ac_pass_rate < 0.5).
 * Exposable.
 */
#[ViewsFilter('bb_metric_value')]
final class BbMetricValue extends NumericFilter {

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
    $this->pinToMetricName();
    parent::query();
  }

}
