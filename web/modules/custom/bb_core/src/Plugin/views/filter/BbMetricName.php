<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\StringFilter;

/**
 * Filters on a bb_metric name column (presence / equality), exposable.
 *
 * Type-level: scope a view to one metric name before aggregating its value
 * (e.g. name = ac_pass_rate, then AVG the value). A thin StringFilter identity
 * so the name axis is a distinct, documented bb_metric handler that any
 * bb_metric field inherits.
 */
#[ViewsFilter('bb_metric_name')]
final class BbMetricName extends StringFilter {

}
