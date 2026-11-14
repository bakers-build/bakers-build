<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The number of a listing's exposed filters with a chosen value.
 *
 * ListingToolbarHooks counts them next to the toolbar it builds; the phone
 * "Filters · N" opener of `bb_theme:filters` shows the number.
 */
#[Source(
  id: self::ID,
  label: new TranslatableMarkup('[View] Active filter count'),
  description: new TranslatableMarkup('How many exposed filters have a chosen value, one per chip.'),
  prop_types: ['number'],
  tags: ['views'],
  context_requirements: ['views:style'],
)]
final class ViewActiveFilterCountSource extends SourcePluginBase {

  /**
   * The plugin ID.
   */
  public const ID = 'bb_view_filter_count';

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $variables = $this->getContextValue('ui_patterns_views:variables');
    }
    catch (\Throwable) {
      // Outside a rendered view (the Display Builder preview) nothing is chosen.
      return 0;
    }
    return is_array($variables) ? (int) ($variables['bb_active_count'] ?? 0) : 0;
  }

}
