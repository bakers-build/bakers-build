<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * Supplies a source from a provider distinct from UI Patterns itself.
 */
#[Source(
  id: 'profile_marker',
  label: new TranslatableMarkup('Profile marker'),
  prop_types: ['string'],
)]
final class ProfileMarker extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): string {
    return 'Profile source marker';
  }

}
