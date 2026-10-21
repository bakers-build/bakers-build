<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\UiPatterns\Source;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\bb_track\Access\WorklogFormAccess;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The Record time affordance on the time calendars, as a dialog.
 *
 * It always records the viewer's own time and opens on the calendar's
 * selected date, project and ticket.
 */
#[Source(
  id: 'bb_worklog_create_action',
  label: new TranslatableMarkup('[bakers.build] Record time action'),
  description: new TranslatableMarkup('The add action that opens the record-time dialog over a time calendar.'),
  prop_types: ['slot'],
)]
final class WorklogCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'bb_track.worklog.add';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Record time');
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
  protected function appliesToCurrentRoute(): bool {
    return in_array($this->routeMatch->getRouteName(), [
      'view.worklog.page',
      'view.worklog.personal',
      'view.worklog.team',
      'view.worklog.project',
    ], TRUE);
  }

  /**
   * {@inheritdoc}
   */
  protected function prefill(): array {
    $query = $this->requestStack->getCurrentRequest()?->query->all() ?? [];
    $prefill = [];
    $date = $query['date'] ?? NULL;
    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1) {
      $prefill['date'] = $date;
    }
    $project = $this->routeMatch->getParameter('bb_project');
    if ($project instanceof BbProjectInterface) {
      $prefill['project'] = (string) $project->id();
    }
    foreach (['project', 'ticket'] as $key) {
      $value = $query[$key] ?? NULL;
      if (!isset($prefill[$key]) && is_string($value) && preg_match('/^[1-9]\d*$/', $value) === 1) {
        $prefill[$key] = $value;
      }
    }
    $submission = $query['submission'] ?? NULL;
    if (is_string($submission) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $submission) === 1) {
      $prefill['submission'] = $submission;
    }
    return $prefill;
  }

  /**
   * {@inheritdoc}
   *
   * The add route is not workspace-prefixed, so the shared helper cannot
   * pass `bb_workspace` into it. Offer the plus when My time has a
   * workspace and the add route itself would allow recording.
   */
  protected function createAccess(): AccessResultInterface {
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if ($this->routeMatch->getRouteName() === 'view.worklog.personal') {
      return WorklogFormAccess::add($this->currentUser);
    }
    if (!$workspace instanceof BbWorkspaceInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $allowed = WorklogFormAccess::canRecord($this->currentUser, $workspace);
    return ($allowed ? AccessResult::allowed() : AccessResult::forbidden())
      ->addCacheContexts(['route', 'user', 'user.permissions'])
      ->addCacheTags(['og_membership_list']);
  }

}
