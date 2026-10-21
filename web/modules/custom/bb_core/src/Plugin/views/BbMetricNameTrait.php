<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\views\Plugin\views\query\Sql;

/**
 * Shared "pin to one metric name" logic for bb_metric Views handlers.
 *
 * A bb_metric field is multi-value: one delta per named metric. A value
 * handler (field / sort / value-filter) targets the sibling value column; to
 * correlate that value with a single metric it must add a predicate on the
 * name column of the SAME delta row. This trait supplies the shared
 * `metric_name` option, its form, and the predicate — DRY, one home for the
 * pin-to-named-delta logic. It relies on the views_data-provided
 * `bb_metric_name_column` (the sibling name column) so it never hardcodes a
 * field name and works for any bb_metric field.
 */
trait BbMetricNameTrait {

  /**
   * Adds the `metric_name` option default.
   *
   * @param array $options
   *   The option definitions to extend.
   */
  protected function metricNameDefineOptions(array &$options): void {
    $options['metric_name'] = ['default' => ''];
  }

  /**
   * Adds the `metric_name` form element.
   *
   * @param array $form
   *   The options form to extend.
   */
  protected function metricNameBuildOptionsForm(array &$form): void {
    $form['metric_name'] = [
      '#type' => 'textfield',
      '#title' => new TranslatableMarkup('Metric name'),
      '#description' => new TranslatableMarkup('Pin this handler to the metric carrying this name (e.g. ac_pass_rate). Leave empty to target every delta.'),
      '#default_value' => $this->options['metric_name'] ?? '',
    ];
  }

  /**
   * Constrains the query to the delta whose name column equals metric_name.
   *
   * Forces a dedicated join alias per metric name and repoints
   * `$this->tableAlias` at it, so the sibling value column this handler renders
   * (added against `tableAlias` by the caller after this runs) reads from the
   * SAME delta row the name predicate constrains. Without a per-name alias,
   * `ensureMyTable()` dedupes joins by (table, relationship): two handlers
   * pinned to different names would share one alias and their predicates would
   * AND into `name = A AND name = B` → zero rows. Callers
   * must invoke this BEFORE adding their value field/sort/where so it uses the
   * pinned alias.
   */
  protected function pinToMetricName(): void {
    $name = (string) ($this->options['metric_name'] ?? '');
    if ($name === '') {
      return;
    }
    $name_column = $this->definition['bb_metric_name_column'] ?? NULL;
    if ($name_column === NULL || !$this->query instanceof Sql) {
      return;
    }
    $alias = $this->query->queueTable($this->table, $this->relationship, $this->getJoin(), $this->metricJoinAlias($name));
    if ($alias === FALSE) {
      // queueTable could not resolve the relationship; fall back to the shared
      // alias rather than break the query outright.
      $alias = $this->ensureMyTable();
    }
    $this->tableAlias = $alias;
    $group = $this->options['group'] ?? 0;
    $this->query->addWhere($group, "$alias.$name_column", $name, '=');
  }

  /**
   * Builds a deterministic join alias for a metric name.
   *
   * Keyed on the metric name (not the handler instance) so that all handlers
   * pinned to the same name share one join — their identical `name = X`
   * predicate is not a contradiction — while distinct names get distinct joins.
   *
   * @param string $name
   *   The metric name to pin to.
   *
   * @return string
   *   A join alias unique to this field table + metric name.
   */
  private function metricJoinAlias(string $name): string {
    $suffix = substr((string) preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), 0, 32);
    return $this->table . '__' . $suffix;
  }

}
