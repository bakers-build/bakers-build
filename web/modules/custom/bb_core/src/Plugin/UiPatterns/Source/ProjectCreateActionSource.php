<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The `New project` affordance, for whatever slot a screen puts it in.
 *
 * The sibling of `TicketCreateActionSource`, offered by the shell
 * `page_header` island and kept off every route but the projects screen.
 * Everything but the subject lives in `CreateActionSourceBase`.
 */
#[Source(
  id: 'bb_project_create_action',
  label: new TranslatableMarkup('[bakers.build] New project action'),
  description: new TranslatableMarkup('The add action that opens the create-project dialog over the current screen.'),
  prop_types: ['slot'],
)]
final class ProjectCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_project.create_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('New project');
  }

  /**
   * {@inheritdoc}
   *
   * No: the project dialog has no context field; the workspace switches
   * globally in the shell.
   */
  protected function forwardsScreenQuery(): bool {
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  protected function appliesToCurrentRoute(): bool {
    return $this->routeMatch->getRouteName() === 'view.projects.workspace_list';
  }

}
