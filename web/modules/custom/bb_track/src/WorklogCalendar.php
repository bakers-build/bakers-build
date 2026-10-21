<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\user\UserInterface;

/**
 * Builds the time calendar's selection from its context and the request.
 *
 * Contexts: personal (subject: the account), workspace (the workspace), team
 * (the team) and project (the project). The context scope only narrows; query
 * access applies on top.
 */
final class WorklogCalendar {

  /**
   * Constructs the calendar.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbWorkspaceReadScopeInterface $readScope,
    private readonly WorklogScope $scope,
    private readonly ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * Resolves a strict selection for a context, subject, viewer and query.
   *
   * @param string $context
   *   One of WorklogSelection::CONTEXTS.
   * @param \Drupal\Core\Entity\EntityInterface|null $subject
   *   The context subject.
   * @param \Drupal\Core\Session\AccountInterface $viewer
   *   The viewing account.
   * @param array<string, mixed> $query
   *   Request query.
   */
  public function selection(string $context, ?EntityInterface $subject, AccountInterface $viewer, array $query): WorklogSelection {
    $projects = $this->projectOptions($context, $subject, $viewer);
    $raw_project = $context === 'project' ? (string) array_key_first($projects) : ($query['project'] ?? NULL);
    $submission = $this->ownSubmission($query['submission'] ?? NULL, $viewer);
    if (is_array($submission) && !isset($query['date']) && $submission['first_date'] !== NULL) {
      $query['date'] = $submission['first_date'];
    }
    return WorklogSelection::fromQuery(
      $query,
      $context,
      (int) $viewer->id(),
      $this->timezone($viewer),
      [
        'projects' => $projects,
        'tickets' => is_string($raw_project) && isset($projects[$raw_project]) ? $this->ticketOptions((int) $raw_project) : [],
        'people' => $this->scope->people($viewer, $context, $subject),
      ],
      $this->contextScope($context, $subject, $viewer),
      is_array($submission) ? ['id' => $submission['id'], 'uuid' => $submission['uuid']] : $submission,
    );
  }

  /**
   * Resolves a `submission` query value to the viewer's own submission.
   *
   * @return array{id: int, uuid: string, first_date: ?string}|false|null
   *   The submission, FALSE when it is not the viewer's, NULL when absent.
   */
  private function ownSubmission(mixed $uuid, AccountInterface $viewer): array|false|null {
    if ($uuid === NULL || $uuid === '') {
      return NULL;
    }
    if (!is_string($uuid) || $viewer->isAnonymous()) {
      return FALSE;
    }
    $ids = $this->entityTypeManager->getStorage('bb_track_submission')->getQuery()->accessCheck(FALSE)
      ->condition('uuid', $uuid)->condition('owner_user_id', $viewer->id())->execute();
    if ($ids === []) {
      return FALSE;
    }
    $id = (int) reset($ids);
    $dates = $this->entityTypeManager->getStorage('bb_track_worklog')->getQuery()->accessCheck(FALSE)
      ->condition('submission_id', $id)->condition('owner_user_id', $viewer->id())->condition('voided', 0)
      ->sort('work_date')->range(0, 1)->execute();
    $first_entry = $dates === [] ? NULL : $this->entityTypeManager->getStorage('bb_track_worklog')->load(reset($dates));
    $first = $first_entry instanceof Worklog ? $first_entry->get('work_date')->value : NULL;
    return ['id' => $id, 'uuid' => $uuid, 'first_date' => $first];
  }

  /**
   * Offered projects keyed by id, labelled "Customer · Project".
   *
   * @return array<string, string>
   *   Options sorted by customer, then project.
   */
  public function projectOptions(string $context, ?EntityInterface $subject, AccountInterface $viewer): array {
    if ($context === 'project') {
      return $subject instanceof BbProjectInterface && $subject->access('view', $viewer)
        ? [(string) $subject->id() => $this->projectLabel($subject)]
        : [];
    }
    $workspace_id = $this->workspaceId($context, $subject);
    $options = [];
    foreach ($this->viewableProjects($viewer) as $project) {
      $group = $project->get('group_id')->entity;
      $workspace_of = $group instanceof BbGroupInterface ? (int) $group->get('workspace_id')->target_id : NULL;
      if ($workspace_id === NULL || $workspace_of === $workspace_id) {
        $options[(string) $project->id()] = $this->projectLabel($project);
      }
    }
    asort($options, SORT_NATURAL | SORT_FLAG_CASE);
    return $options;
  }

  /**
   * The "Customer · Project" label of a project.
   */
  public function projectLabel(BbProjectInterface $project): string {
    $group = $project->get('group_id')->entity;
    return $group instanceof BbGroupInterface
      ? $group->label() . ' · ' . $project->label()
      : (string) $project->label();
  }

  /**
   * The "KEY-123 title" label of a ticket.
   */
  public function ticketLabel(BbTicketInterface $ticket): string {
    return trim($ticket->getIdentifier() . ' ' . $ticket->label());
  }

  /**
   * Actor, site or UTC timezone.
   */
  public function timezone(AccountInterface $viewer): \DateTimeZone {
    $name = (string) $viewer->getTimeZone();
    if ($name === '') {
      $name = (string) ($this->configFactory->get('system.date')->get('timezone.default') ?? '');
    }
    try {
      return new \DateTimeZone($name !== '' ? $name : 'UTC');
    }
    catch (\Exception) {
      return new \DateTimeZone('UTC');
    }
  }

  /**
   * Viewable tickets of a project.
   *
   * @return array<string, string>
   *   Labels keyed by id.
   */
  private function ticketOptions(int $project_id): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('project_id', $project_id)
      ->sort('id')
      ->execute();
    $options = [];
    foreach ($storage->loadMultiple($ids) as $ticket) {
      if ($ticket instanceof BbTicketInterface) {
        $options[(string) $ticket->id()] = $this->ticketLabel($ticket);
      }
    }
    return $options;
  }

  /**
   * Projects the viewer can see in any workspace.
   *
   * @return list<\Drupal\bb_core\Entity\BbProjectInterface>
   *   Projects.
   */
  private function viewableProjects(AccountInterface $viewer): array {
    $ids = $this->readScope->projectIds($viewer);
    if ($ids === []) {
      return [];
    }
    $projects = [];
    foreach ($this->entityTypeManager->getStorage('bb_project')->loadMultiple($ids) as $project) {
      if ($project instanceof BbProjectInterface && $project->access('view', $viewer)) {
        $projects[] = $project;
      }
    }
    return $projects;
  }

  /**
   * Owners and projects a context restricts to; NULL is unrestricted.
   *
   * @return array{owners: list<int>|null, projects: list<int>|null}
   *   Context scope.
   */
  private function contextScope(string $context, ?EntityInterface $subject, AccountInterface $viewer): array {
    $uid = (int) $viewer->id();
    $workspace_id = $this->workspaceId($context, $subject);
    $workspace_projects = $workspace_id === NULL ? [] : $this->scope->workspaceProjectIds($workspace_id);
    return match ($context) {
      'personal' => [
        'owners' => $subject instanceof UserInterface && (int) $subject->id() === $uid && $uid !== 0 ? [$uid] : [],
        'projects' => NULL,
      ],
      'team' => [
        'owners' => array_keys($this->scope->people($viewer, 'team', $subject)),
        'projects' => $workspace_projects,
      ],
      'project' => [
        'owners' => NULL,
        'projects' => $subject instanceof BbProjectInterface ? [(int) $subject->id()] : [],
      ],
      default => [
        'owners' => [$uid],
        'projects' => $workspace_projects,
      ],
    };
  }

  /**
   * The workspace a context is bounded by; NULL for personal.
   */
  private function workspaceId(string $context, ?EntityInterface $subject): ?int {
    return match (TRUE) {
      $context === 'personal' => NULL,
      $subject instanceof BbWorkspaceInterface => (int) $subject->id(),
      $subject instanceof BbTeamInterface => (int) $subject->get('workspace_id')->target_id,
      default => 0,
    };
  }

}
