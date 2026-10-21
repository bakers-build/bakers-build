<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Hook\Order\Order;
use Drupal\bb_core\Plugin\UiPatterns\Source\ViewSearchToolbarSource;
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
      unset($exposed[$key]);
    }
    $variables['bb_toolbar'] = $toolbar;
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
