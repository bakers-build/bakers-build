<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;

/**
 * Opens the shared team creation dialog in the current workspace.
 */
#[Source(
  id: 'bb_team_create_action',
  label: new TranslatableMarkup('[bakers.build] New team action'),
  description: new TranslatableMarkup('Opens the workspace team creation dialog.'),
  prop_types: ['slot'],
)]
final class TeamCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_team.create_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('New team');
  }

  /**
   * {@inheritdoc}
   */
  protected function forwardsScreenQuery(): bool {
    return FALSE;
  }

}
