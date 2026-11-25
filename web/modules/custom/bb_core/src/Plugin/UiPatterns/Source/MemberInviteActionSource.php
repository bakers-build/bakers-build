<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Form\WorkspaceInviteForm;
use Drupal\ui_patterns\Attribute\Source;

/**
 * Opens the invite dialog from the workspace Members page header.
 */
#[Source(
  id: 'bb_member_invite_action',
  label: new TranslatableMarkup('[bakers.build] Invite members action'),
  description: new TranslatableMarkup('Opens the workspace invite dialog on the Members screen.'),
  prop_types: ['slot'],
)]
final class MemberInviteActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'bb_core.workspace_invite';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Invite members');
  }

  /**
   * {@inheritdoc}
   */
  protected function forwardsScreenQuery(): bool {
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerId(): string {
    return WorkspaceInviteForm::TRIGGER_ID;
  }

  /**
   * {@inheritdoc}
   */
  protected function appliesToCurrentRoute(): bool {
    return $this->routeMatch->getRouteName() === 'bb_core.bb_workspace.members';
  }

}
