<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Team entity form with a meta header block.
 *
 * The workspace is ambient — the same trait the group form uses,
 * so the two cannot drift apart.
 */
final class BbTeamForm extends BbContentEntityFormBase {

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
