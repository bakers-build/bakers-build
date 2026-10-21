<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Conductor entity form with a meta header block.
 */
final class BbConductorForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Meta'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => ['owner_user_id', 'status', 'project_id', 'last_seen', 'lease_expires_at', 'created', 'changed'],
      ],
    ];
  }

}
