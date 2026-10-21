<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * A view's search field and sort select, printed outside its exposed form.
 *
 * Reads the elements ListingToolbarHooks moved out of the exposed form; they
 * still submit with it through their `form` attribute. Placed inside a
 * `bb_theme:filters` bar directly above the list.
 *
 * @see \Drupal\bb_core\Hook\ListingToolbarHooks
 */
#[Source(
  id: self::ID,
  label: new TranslatableMarkup('[View] Search and sort'),
  description: new TranslatableMarkup("The view's search field and sort select, bound to its exposed form."),
  prop_types: ['slot'],
  tags: ['views'],
  context_requirements: ['views:style'],
)]
final class ViewSearchToolbarSource extends SourcePluginBase {

  /**
   * The plugin ID, also what ListingToolbarHooks looks for in a tree.
   */
  public const ID = 'bb_view_search';

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $variables = $this->getContextValue('ui_patterns_views:variables');
    }
    catch (\Throwable) {
      // Outside a rendered view (the Display Builder preview) there is no
      // form to bind to.
      return [];
    }
    return is_array($variables) ? ($variables['bb_toolbar'] ?? []) : [];
  }

}
