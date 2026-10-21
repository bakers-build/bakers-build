<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Group entity form with a meta header block.
 *
 * The workspace is ambient: resolved from the route or the
 * account's sole membership, filled and hidden, and replaced by a read-only
 * context line — see AmbientWorkspaceFormTrait.
 */
final class BbGroupForm extends BbContentEntityFormBase {

  use AmbientWorkspaceFormTrait;

  /**
   * {@inheritdoc}
   */
  protected function ambientWorkspaceField(): string {
    return 'workspace_id';
  }

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Meta'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => ['created', 'changed'],
      ],
    ];
  }

}
