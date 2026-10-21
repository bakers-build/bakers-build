<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;

/**
 * Opens the shared group creation dialog in the current workspace.
 */
#[Source(
  id: 'bb_group_create_action',
  label: new TranslatableMarkup('[bakers.build] New group action'),
  description: new TranslatableMarkup('Opens the workspace group creation dialog.'),
  prop_types: ['slot'],
)]
final class GroupCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_group.create_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('New group');
  }

  /**
   * {@inheritdoc}
   *
   * The shared shell `page_header` offers every create action, so the
   * Groups trigger scopes itself to the Groups screen.
   */
  protected function appliesToCurrentRoute(): bool {
    return $this->routeMatch->getRouteName() === 'view.groups.workspace_list';
  }

  /**
   * {@inheritdoc}
   */
  protected function forwardsScreenQuery(): bool {
    return FALSE;
  }

}
