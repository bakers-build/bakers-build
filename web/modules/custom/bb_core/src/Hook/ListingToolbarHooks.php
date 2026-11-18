<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Hook\Order\Order;
use Drupal\bb_core\Plugin\UiPatterns\Source\ViewSearchToolbarSource;
use Drupal\bb_core\Plugin\views\filter\BbClosedRows;
use Drupal\views\ViewExecutable;

/**
 * Moves a listing's search and sort fields into its toolbar.
 *
 * A view whose Display Builder tree places the "[View] Search and sort" source
 * prints its search field (identifier `title`) and BEF's combined sort select
 * there, above the list, instead of inside the exposed form. The fields stay
 * part of that form through the HTML `form` attribute, so search, sort and the
 * remaining filters always submit together. Only where they print changes:
 * the form was already built and processed when this runs.
 */
final class ListingToolbarHooks {

  /**
   * The exposed elements the toolbar takes, in toolbar order.
   */
  private const ELEMENTS = ['title', 'sort_bef_combine'];

  /**
   * Implements hook_preprocess_views_view().
   *
   * First, so Display Builder's own preprocess already sees the moved
   * elements when it builds its sources.
   *
   * @param array<string, mixed> $variables
   *   The views-view variables.
   */
  #[Hook('preprocess_views_view', order: Order::First)]
  public function preprocessViewsView(array &$variables): void {
    $view = $variables['view'] ?? NULL;
    if (!$view instanceof ViewExecutable || empty($variables['exposed']) || !$this->placesToolbar($view)) {
      return;
    }
    $exposed = &$variables['exposed'];
    $form_id = $exposed['#id'] ?? NULL;
    if (!is_string($form_id)) {
      return;
    }

    $toolbar = [];
    foreach (self::ELEMENTS as $key) {
      if (!isset($exposed[$key])) {
        continue;
      }
      $element = $exposed[$key];
      $element['#attributes']['form'] = $form_id;
      // Toolbar order is search, then sort, whatever weight the form gave.
      $element['#weight'] = count($toolbar);
      // Views sets exposed labels in the exposed form's own preprocess, which
      // a moved element no longer passes through.
      foreach ($exposed['#info'] ?? [] as $info) {
        if (($info['value'] ?? NULL) === $key && !empty($info['label'])) {
          $element['#title'] = $info['label'];
        }
      }
      $toolbar[$key] = $element;
      // UI Patterns' "view_exposed" source renders $view->exposed_widgets, not
      // the preprocessed variable.
      unset($exposed[$key], $view->exposed_widgets[$key]);
    }
    $variables['bb_toolbar'] = $toolbar;
    $variables['bb_active_count'] = $this->activeCount($view);
  }

  /**
   * The number of exposed filters with a chosen value: one per chip.
   *
   * The phone "Filters · N" opener shows it. The search field and the closed
   * control are not chips, so they do not count; a multi-value filter counts
   * once, as its chip does.
   */
  private function activeCount(ViewExecutable $view): int {
    $input = $view->getExposedInput();
    $count = 0;
    foreach ($view->filter as $filter) {
      if (!$filter->isExposed() || $filter instanceof BbClosedRows) {
        continue;
      }
      $identifier = $filter->options['expose']['identifier'] ?? '';
      if ($identifier === '' || in_array($identifier, self::ELEMENTS, TRUE)) {
        continue;
      }
      $values = array_filter(
        (array) ($input[$identifier] ?? []),
        static fn ($value): bool => !in_array($value, ['', '0', 'All', NULL], TRUE),
      );
      $count += $values === [] ? 0 : 1;
    }
    return $count;
  }

  /**
   * Whether the display's Display Builder tree places the toolbar source.
   */
  private function placesToolbar(ViewExecutable $view): bool {
    $extenders = $view->display_handler->getOption('display_extenders') ?? [];
    $sources = $extenders['display_builder']['sources'] ?? [];
    return str_contains((string) json_encode($sources), '"' . ViewSearchToolbarSource::ID . '"');
  }

}
