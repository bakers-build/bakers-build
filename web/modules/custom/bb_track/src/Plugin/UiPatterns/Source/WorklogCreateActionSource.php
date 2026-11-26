<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\UiPatterns\Source;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSource;
use Drupal\bb_track\Access\WorklogFormAccess;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The Record time affordance on the time calendars, as a dialog.
 *
 * A `bb_create_action` whose access is narrower than its route's: the add
 * route is not workspace-prefixed and allows recording in any workspace, while
 * a workspace calendar offers the plus only to who may record in THAT one.
 */
#[Source(
  id: 'bb_worklog_create_action',
  label: new TranslatableMarkup('[bakers.build] Record time action'),
  description: new TranslatableMarkup('The add action that opens the record-time dialog over a time calendar.'),
  prop_types: ['slot'],
)]
final class WorklogCreateActionSource extends CreateActionSource {

  /**
   * {@inheritdoc}
   *
   * My time records in any workspace; a workspace calendar needs the right to
   * record in its workspace.
   */
  protected function createAccess(): AccessResultInterface {
    if ($this->routeMatch->getRouteName() === 'view.worklog.personal') {
      return WorklogFormAccess::add($this->currentUser);
    }
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $allowed = WorklogFormAccess::canRecord($this->currentUser, $workspace);
    return ($allowed ? AccessResult::allowed() : AccessResult::forbidden())
      ->addCacheContexts(['route', 'user', 'user.permissions'])
      ->addCacheTags(['og_membership_list']);
  }

}
