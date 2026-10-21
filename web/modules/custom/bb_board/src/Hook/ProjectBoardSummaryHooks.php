<?php

declare(strict_types=1);

namespace Drupal\bb_board\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Hook\Order\Order;
use Drupal\bb_board\Plugin\views\area\BbBoardSummary;
use Drupal\search_api\Query\QueryInterface;

/**
 * Adds the board summary's aggregations to the search that asked for them.
 *
 * LAST, because facets_exposed_filters' own alter REPLACES the whole
 * `search_api_facets` option with its facets; an earlier request is lost.
 */
final class ProjectBoardSummaryHooks {

  /**
   * Implements hook_search_api_query_alter().
   */
  #[Hook('search_api_query_alter', order: Order::Last)]
  public function searchApiQueryAlter(QueryInterface $query): void {
    if (!$query->getOption(BbBoardSummary::OPTION)) {
      return;
    }
    $facets = $query->getOption('search_api_facets', []);
    $query->setOption('search_api_facets', (is_array($facets) ? $facets : []) + BbBoardSummary::aggregations());
  }

}
