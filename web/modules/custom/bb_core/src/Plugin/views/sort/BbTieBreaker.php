<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\sort;

use Drupal\search_api\Plugin\views\query\SearchApiQuery;
use Drupal\views\Attribute\ViewsSort;
use Drupal\views\Plugin\views\query\Sql;
use Drupal\views\Plugin\views\sort\SortPluginBase;

/**
 * A unique last sort that follows the direction of the chosen sort.
 *
 * Equal primary values (two tickets updated in the same second, one owner for
 * every group) are ordered by a unique ID so pages stay stable. Taking the
 * chosen direction rather than a fixed ascending one makes "Z–A" or "oldest
 * first" visibly reverse such ties too. Works on SQL and Search API views.
 */
#[ViewsSort('bb_tie_breaker')]
final class BbTieBreaker extends SortPluginBase {

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $order = $this->followedOrder();
    if ($this->query instanceof Sql) {
      $this->ensureMyTable();
      $this->query->addOrderBy($this->tableAlias, $this->realField, $order);
      return;
    }
    // Always the last sort, so the search_api sorts before it have already
    // reset the query's sorts when the exposed form re-applies them.
    if ($this->query instanceof SearchApiQuery) {
      $this->query->sort($this->realField, $order);
    }
  }

  /**
   * The chosen exposed direction, else the first exposed sort's own.
   */
  private function followedOrder(): string {
    $chosen = $this->view->exposed_data['sort_order'] ?? NULL;
    if (in_array($chosen, ['ASC', 'DESC'], TRUE)) {
      return $chosen;
    }
    foreach ($this->view->sort as $sort) {
      if ($sort !== $this && $sort->isExposed()) {
        return $sort->options['order'] === 'DESC' ? 'DESC' : 'ASC';
      }
    }
    return $this->options['order'] === 'DESC' ? 'DESC' : 'ASC';
  }

}
