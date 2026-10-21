<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\sort;

use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Plugin\views\BbMetricNameTrait;
use Drupal\views\Attribute\ViewsSort;
use Drupal\views\Plugin\views\query\Sql;
use Drupal\views\Plugin\views\sort\SortPluginBase;

/**
 * Sorts by a bb_metric value, pinned to a configurable metric name.
 *
 * Type-level: ORDER BY the named metric's value (e.g. rank tickets by
 * ac_pass_rate).
 */
#[ViewsSort('bb_metric_value')]
final class BbMetricValue extends SortPluginBase {

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
    if (!$this->query instanceof Sql) {
      return;
    }
    $this->ensureMyTable();
    $this->query->addOrderBy($this->tableAlias, $this->realField, $this->options['order']);
  }

}
