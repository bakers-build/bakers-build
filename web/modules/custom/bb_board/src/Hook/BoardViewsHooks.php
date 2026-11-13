<?php

declare(strict_types=1);

namespace Drupal\bb_board\Hook;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_board\BoardAddress;
use Drupal\bb_board\BoardHealth;
use Drupal\bb_board\BoardPreferences;
use Drupal\search_api\Plugin\views\query\SearchApiQuery;
use Drupal\views\Plugin\views\query\QueryPluginBase;
use Drupal\views\ViewExecutable;

/**
 * Registers the Board's Views handlers.
 */
final class BoardViewsHooks {

  /**
   * The Done column's window: seven days, in seconds.
   */
  private const DONE_WINDOW = 604800;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BoardHealth $health,
    private readonly BoardPreferences $preferences,
    private readonly TimeInterface $time,
  ) {}

  /**
   * Implements hook_views_pre_view().
   *
   * The page display runs once per Board request; its columns read the
   * stored preferences.
   */
  #[Hook('views_pre_view')]
  public function viewsPreView(ViewExecutable $view, ?string $displayId): void {
    if ($view->id() === 'project_board' && $displayId === 'project_board') {
      $this->preferences->rememberRequest();
    }
  }

  /**
   * Implements hook_views_query_alter().
   *
   * The page's own search counts the open columns only; Done is a column, not
   * a filter, and shows the last seven days unless Show older asks for more.
   * The Unhealthy filter narrows every display to the attention set, and an
   * empty set matches nothing, never everything.
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
    if ($view->current_display === 'done' && !$this->preferences->doneOlder()) {
      $query->createAndAddConditionGroup()->addCondition('closed_date', $this->time->getRequestTime() - self::DONE_WINDOW, '>=');
    }
    if (!$this->health->requested($view)) {
      return;
    }
    $query->createAndAddConditionGroup()->addCondition('health', ['warning', 'critical'], 'IN');
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
