<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Project entity form with a meta header block.
 */
final class BbProjectForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Meta'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => ['group_id', 'created', 'changed'],
      ],
    ];
  }

}
