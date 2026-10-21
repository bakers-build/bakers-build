<?php

declare(strict_types=1);

namespace Drupal\bb_board\Hook;

use Drupal\Core\Hook\Attribute\Hook;

/**
 * Names the wrapper Views puts around each Project Board column.
 *
 * Views wraps every attached display in a plain `container`, which sits
 * between the board's column row and the column, so the column cannot share
 * the row's width. The suggestion lets the theme lay that wrapper out.
 */
final class ProjectBoardColumnHooks {

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

}
