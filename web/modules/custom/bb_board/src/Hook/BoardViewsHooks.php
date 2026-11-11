<?php

declare(strict_types=1);

namespace Drupal\bb_board\Hook;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_board\BoardAddress;
use Drupal\bb_board\BoardHealth;
use Drupal\search_api\Plugin\views\query\SearchApiQuery;
use Drupal\views\Plugin\views\query\QueryPluginBase;
use Drupal\views\ViewExecutable;

/**
 * Registers the Board's Views handlers.
 */
final class BoardViewsHooks {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BoardHealth $health,
  ) {}

  /**
   * Implements hook_views_query_alter().
   *
   * The page's own search counts the open columns only; Done is a column, not
   * a filter. The Unhealthy filter narrows every display to the attention set,
   * and an empty set matches nothing, never everything.
   */
  #[Hook('views_query_alter')]
  public function viewsQueryAlter(ViewExecutable $view, QueryPluginBase $query): void {
    if ($view->id() !== 'project_board' || !$query instanceof SearchApiQuery || $query->shouldAbort()) {
      return;
    }
    // Built already: a condition goes straight onto the Search API query.
    if ($view->current_display === 'project_board') {
      $query->createAndAddConditionGroup()->addCondition('work_state', BoardAddress::OPEN_WORK_STATES, 'IN');
    }
    if (!$this->health->requested($view)) {
      return;
    }
    $ids = $this->health->unhealthyIds($view);
    if ($ids === []) {
      $query->abort();
      return;
    }
    // The indexed entity id, as the parent filter: search_api_db drops
    // search_api_id from the facet queries.
    $query->createAndAddConditionGroup()->addCondition('ticket_id', $ids, 'IN');
  }

  /**
   * Implements hook_views_data_alter().
   *
   * @param array<string, mixed> $data
   *   The Views data to alter.
   */
  #[Hook('views_data_alter')]
  public function viewsDataAlter(array &$data): void {
    $data['views']['bb_board_summary'] = [
      'title' => new TranslatableMarkup('Project board control panel'),
      'help' => new TranslatableMarkup('The filter bar and active filters, counted over every page and column.'),
      'area' => ['id' => 'bb_board_summary'],
    ];
    // An index that is not installed yet has no Views table to extend.
    if (!$this->entityTypeManager->hasDefinition('search_api_index')) {
      return;
    }
    foreach ($this->entityTypeManager->getStorage('search_api_index')->loadMultiple() as $index) {
      $table = 'search_api_index_' . $index->id();
      if (!isset($data[$table]['project_id']) || !in_array('entity:bb_ticket', array_keys($index->getDatasources()), TRUE)) {
        continue;
      }
      $data[$table]['board_parent'] = [
        'title' => new TranslatableMarkup('Board parent'),
        'help' => new TranslatableMarkup("A parent ticket's visible open descendants, at every depth."),
        'real field' => 'project_id',
        'filter' => ['id' => 'bb_board_parent'],
      ];
    }
  }

}
