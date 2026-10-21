<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\area;

use Drupal\views\Attribute\ViewsArea;
use Drupal\views\Plugin\views\area\TextCustom;

/**
 * Decorates the configured empty text without changing its selection rules.
 */
#[ViewsArea('bb_empty')]
final class BbEmpty extends TextCustom {

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function render($empty = FALSE) {
    $build = parent::render($empty);
    if (isset($build['#markup'])) {
      return [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $build['#markup'], 'icon' => 'inbox', 'compact' => TRUE],
      ];
    }
    return $build;
  }

}
