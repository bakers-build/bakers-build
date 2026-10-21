<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\views\Plugin\views\field\EntityOperations;
use Drupal\views\ResultRow;

/**
 * Entity operations that name their row for assistive technology.
 *
 * Every row's menu trigger would otherwise read the same "Actions". The name
 * travels as the element's `aria-label`; bb_theme's operations template
 * reads it, and admin themes keep it on their dropbutton list.
 */
final class BbEntityOperations extends EntityOperations {

  /**
   * {@inheritdoc}
   */
  public function render(ResultRow $values) {
    $build = parent::render($values);
    $entity = $this->getEntity($values);
    if (is_array($build) && $entity !== NULL) {
      $build['#attributes']['aria-label'] = (string) $this->t('Actions for @label', ['@label' => (string) $entity->label()]);
    }
    return $build;
  }

}
