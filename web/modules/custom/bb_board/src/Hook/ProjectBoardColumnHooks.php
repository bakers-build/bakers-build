<?php

declare(strict_types=1);

namespace Drupal\bb_board\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_board\BoardAddress;
use Drupal\bb_board\BoardPreferences;
use Drupal\bb_board\Plugin\views\display\BbBoardColumn;
use Drupal\views\ViewExecutable;

/**
 * Hands the Project Board columns to the board's column header.
 *
 * Each column display gets its header data: label, count, tone, and for Done
 * the caption and the Show done, Show older and Hide done links. With Details
 * on, the state sub-columns become one Working panel.
 *
 * Views wraps every attached display in a plain `container`, which sits
 * between the board's column row and the column, so the column cannot share
 * the row's width. The suggestion lets the theme drop that wrapper.
 */
final class ProjectBoardColumnHooks {

  use StringTranslationTrait;

  /**
   * Header properties by column display; label and count come from the view.
   */
  private const COLUMNS = [
    'backlog' => ['tone' => 'wait'],
    'intake' => ['tone' => 'attention'],
    'working' => ['tone' => 'running'],
    'working_plan' => ['nested' => TRUE],
    'working_working' => ['nested' => TRUE],
    'working_review' => ['nested' => TRUE],
    'done' => ['tone' => 'idle', 'terminal' => TRUE],
  ];

  public function __construct(
    private readonly BoardPreferences $preferences,
  ) {}

  /**
   * Implements hook_theme().
   *
   * @return array<string, array<string, mixed>>
   *   The Working panel that holds the state sub-columns.
   */
  #[Hook('theme')]
  public function theme(): array {
    return ['bb_board_column_group' => ['variables' => ['column' => []]]];
  }

  /**
   * Implements hook_theme_suggestions_container_alter().
   *
   * @param array<int, string> $suggestions
   *   The suggestions.
   * @param array<string, mixed> $variables
   *   The container variables.
   */
  #[Hook('theme_suggestions_container_alter')]
  public function themeSuggestionsContainerAlter(array &$suggestions, array $variables): void {
    if (($variables['element']['#view_display_plugin_id'] ?? NULL) === 'bb_board_column') {
      $suggestions[] = 'container__board_column';
    }
  }

  /**
   * Implements hook_preprocess_HOOK() for views_view.
   *
   * @param array<string, mixed> $variables
   *   The views_view variables; a column gets `column` for its header.
   */
  #[Hook('preprocess_views_view')]
  public function preprocessViewsView(array &$variables): void {
    $view = $variables['view'];
    if ($view->display_handler->getPluginId() !== 'bb_board_column') {
      return;
    }
    $display = (string) $view->current_display;
    $variables['column'] = ($display === 'done' ? $this->done($view) : []) + self::COLUMNS[$display] + [
      'label' => $view->getTitle(),
      'count' => (int) $view->total_rows,
      'content' => $variables['rows'],
      'empty' => $variables['empty'],
      'pager' => $variables['pager'],
    ];
  }

  /**
   * Implements hook_views_pre_render().
   *
   * Details on: the state sub-columns become one Working panel. Its count is
   * their sum; a state without tickets drops out and names itself in a hint.
   */
  #[Hook('views_pre_render')]
  public function viewsPreRender(ViewExecutable $view): void {
    if ($view->id() !== 'project_board' || $view->current_display !== 'project_board') {
      return;
    }
    $nested = array_filter(
      $view->attachment_before,
      static fn (array $attachment): bool => BbBoardColumn::DETAILS[$attachment['#display_id'] ?? ''] ?? FALSE,
    );
    if ($nested === []) {
      return;
    }
    $filled = array_filter(array_map($this->count(...), $nested));
    $group = [
      '#theme' => 'bb_board_column_group',
      '#column' => self::COLUMNS['working'] + [
        'label' => $view->displayHandlers->get('working')->getOption('title'),
        'count' => array_sum($filled),
        // Without a filled state the panel is a plain column of lane width.
        'group' => $filled !== [],
        'hints' => array_values(array_map(
          fn (array $attachment): string => (string) $this->t('empty: @state', ['@state' => $attachment['#view']->getTitle()]),
          array_diff_key($nested, $filled),
        )),
        'content' => array_intersect_key($nested, $filled),
      ],
    ];
    array_splice($view->attachment_before, (int) array_key_first($nested), count($nested), [$group]);
  }

  /**
   * Done's header: closed with Show done, open with its window, or older.
   *
   * @return array<string, mixed>
   *   Header properties that win over the column's own.
   */
  private function done(ViewExecutable $view): array {
    $address = BoardAddress::fromView($view);
    $hide = ['label' => $this->t('Hide done'), 'url' => $address->withDone(FALSE)];
    return match (TRUE) {
      !$this->preferences->doneOpen() => [
        'collapsed' => TRUE,
        'pager' => [],
        'toggles' => [['label' => $this->t('Show done'), 'url' => $address->withDone(TRUE)]],
      ],
      $this->preferences->doneOlder() => ['toggles' => [$hide]],
      default => [
        'caption' => $this->t('last 7 days'),
        'toggles' => [['label' => $this->t('Show older'), 'url' => $address->withOlder()], $hide],
      ],
    };
  }

  /**
   * Executes a sub-column now, so the panel knows its count before render.
   *
   * Rendering it later reuses the executed result.
   *
   * @param array<string, mixed> $attachment
   *   A Views attachment element.
   */
  private function count(array $attachment): int {
    $view = $attachment['#view'];
    $view->preExecute($attachment['#arguments']);
    $view->execute();
    $view->postExecute();
    return (int) $view->total_rows;
  }

}
