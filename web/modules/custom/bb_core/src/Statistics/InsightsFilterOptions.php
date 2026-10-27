<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Statistics\Figure\FigureFilterResolver;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementResult;
use Drupal\og\OgMembershipInterface;
use Drupal\bb_core\Statistics\Period\PeriodRange;
use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Drupal\bb_core\Ticket\ProjectOverviewTickets;
use Drupal\user\UserInterface;

/**
 * The entries of the Insights Project, Team, Epic and Person filters.
 *
 * The scope is a workspace (Insights), a project (Project › Stats) or a user
 * (My work › Stats). Each entry carries the tickets closed in the selected
 * period, counted WITHOUT the selected entity filters, so picking one project
 * does not turn every other project's count into 0.
 */
final class InsightsFilterOptions {

  use PersonIdentityTrait;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly MeasurementEvaluatorInterface $evaluator,
    private readonly PeriodResolver $periodResolver,
    private readonly TimeInterface $time,
    private readonly ProjectOverviewTickets $overviewTickets,
  ) {}

  /**
   * The project's epics the account may view, in identifier order.
   *
   * @param \Drupal\bb_core\Entity\BbProjectInterface $project
   *   The project.
   * @param array<string, string|list<string>> $filters
   *   The selected filters; only the period applies.
   *
   * @return list<array{value: string, label: string, count: int}>
   *   The entries; each counts the epic and its subtree.
   */
  public function epics(BbProjectInterface $project, array $filters): array {
    $entries = [];
    foreach ($this->overviewTickets->epicTickets($project) as $epic) {
      $total = $this->closed($project, $filters, ['type' => 'total'], ['epic' => [$epic]]);
      $entries[] = [
        'value' => (string) $epic->uuid(),
        'label' => (string) $epic->label(),
        'count' => (int) ($total?->getValues()['total'] ?? 0),
      ];
    }
    return $entries;
  }

  /**
   * The projects of the scope, in name order.
   *
   * A workspace lists all its projects; a user the projects where their
   * tickets closed or their runs happened in the period.
   *
   * @param \Drupal\Core\Entity\EntityInterface $scope
   *   The workspace or user.
   * @param array<string, string|list<string>> $filters
   *   The selected filters; only the period applies.
   *
   * @return list<array{value: string, label: string, count: int}>
   *   The entries.
   */
  public function projects(EntityInterface $scope, array $filters): array {
    $user = $scope instanceof UserInterface;
    $byProject = ['type' => 'dimension', 'dimension' => 'project'];
    $result = $this->closed($scope, $filters, $byProject + ($user ? [] : ['fill' => TRUE]), []);
    $entries = [];
    foreach ($result?->getCategories() ?? [] as $category) {
      $count = (int) ($result->getValues()[$category['key']] ?? 0);
      $entries[$category['key']] = ['value' => $category['key'], 'label' => $category['label'], 'count' => $count];
    }
    if ($user) {
      foreach ($this->measure('runs', $scope, $filters, $byProject)?->getCategories() ?? [] as $category) {
        $entries[$category['key']] ??= ['value' => $category['key'], 'label' => $category['label'], 'count' => 0];
      }
      unset($entries['unattributed']);
    }
    $entries = array_values($entries);
    usort($entries, static fn(array $left, array $right): int => strnatcasecmp($left['label'], $right['label']));
    return $entries;
  }

  /**
   * The workspace's teams, in name order, counting their projects' tickets.
   *
   * @param \Drupal\Core\Entity\EntityInterface $workspace
   *   The workspace.
   * @param array<string, string|list<string>> $filters
   *   The selected filters; only the period applies.
   *
   * @return list<array{value: string, label: string, count: int}>
   *   The entries.
   */
  public function teams(EntityInterface $workspace, array $filters): array {
    $entries = [];
    foreach ($this->workspaceTeams($workspace) as $team) {
      $total = $this->closed($workspace, $filters, ['type' => 'total'], ['team' => [$team]]);
      $count = (int) ($total?->getValues()['total'] ?? 0);
      $entries[] = ['value' => (string) $team->uuid(), 'label' => (string) $team->label(), 'count' => $count];
    }
    return $entries;
  }

  /**
   * The people of the scope, grouped by their first team in name order.
   *
   * A workspace offers its members and the assignees of its tickets; a
   * project only the assignees of its tickets. The last group, Other, holds
   * the unassigned tickets, people without a team, and former members who are
   * still the assignee of tickets here.
   *
   * @param \Drupal\Core\Entity\EntityInterface $scope
   *   The workspace or project.
   * @param array<string, string|list<string>> $filters
   *   The selected filters; only the period applies.
   *
   * @return list<array{team: string, entries: list<array<string, mixed>>}>
   *   The groups.
   */
  public function people(EntityInterface $scope, array $filters): array {
    $result = $this->closed($scope, $filters, ['type' => 'dimension', 'dimension' => 'user'], []);
    $counts = $result?->getValues() ?? [];
    $workspace = $scope instanceof BbProjectInterface ? $scope->getGroup()?->getWorkspace() : $scope;
    $uids = $scope instanceof BbProjectInterface ? $this->assigneeIds($scope) : $this->memberIds($scope);
    $users = $this->entityTypeManager->getStorage('user')->loadMultiple($uids);
    foreach (array_keys($counts) as $key) {
      if ($key !== 'unattributed') {
        $users += $this->entityTypeManager->getStorage('user')->loadByProperties(['uuid' => $key]);
      }
    }
    $teamOf = $workspace === NULL ? [] : $this->firstTeams($workspace, $users);
    $groups = [];
    foreach ($users as $user) {
      if (!$user instanceof UserInterface || (int) $user->id() === 0) {
        continue;
      }
      $name = $this->personDisplayName($user);
      $entry = [
        'value' => (string) $user->uuid(),
        'label' => $name,
        'count' => (int) ($counts[$user->uuid()] ?? 0),
        'initials' => $this->personInitials($name),
        'color' => $this->personColor((int) $user->id()),
      ];
      $groups[$teamOf[$user->id()] ?? ''][] = $entry;
    }
    $byName = static fn(array $left, array $right): int => strnatcasecmp($left['label'], $right['label']);
    // People without a team in the workspace collect under '' and go to Other.
    $other = $groups[''] ?? [];
    unset($groups['']);
    ksort($groups, SORT_NATURAL | SORT_FLAG_CASE);
    $out = [];
    foreach ($groups as $team => $entries) {
      usort($entries, $byName);
      $out[] = ['team' => (string) $team, 'entries' => $entries];
    }
    usort($other, $byName);
    array_unshift($other, [
      'value' => FigureFilterResolver::UNASSIGNED,
      'label' => 'Unassigned tickets',
      'count' => (int) ($counts['unattributed'] ?? 0),
      'initials' => '?',
      'color' => 'offline',
    ]);
    $out[] = ['team' => 'Other', 'entries' => $other];
    return $out;
  }

  /**
   * Closed tickets in the selected period, shaped by one category definition.
   *
   * @param \Drupal\Core\Entity\EntityInterface $scope
   *   The workspace or project.
   * @param array<string, string|list<string>> $filters
   *   The selected filters; only the period applies.
   * @param array<string, mixed> $definition
   *   The category definition without its range.
   * @param array<string, array<\Drupal\Core\Entity\EntityInterface>> $restrictions
   *   Restriction contexts.
   */
  private function closed(EntityInterface $scope, array $filters, array $definition, array $restrictions): ?MeasurementResult {
    return $this->measure('closed_tickets', $scope, $filters, $definition, $restrictions);
  }

  /**
   * One measurement in the selected period, shaped by a category definition.
   *
   * @param string $id
   *   The measurement id.
   * @param \Drupal\Core\Entity\EntityInterface $scope
   *   The workspace, project or user.
   * @param array<string, string|list<string>> $filters
   *   The selected filters; only the period applies.
   * @param array<string, mixed> $definition
   *   The category definition without its range.
   * @param array<string, array<\Drupal\Core\Entity\EntityInterface>> $restrictions
   *   Restriction contexts.
   */
  private function measure(string $id, EntityInterface $scope, array $filters, array $definition, array $restrictions = []): ?MeasurementResult {
    $measurement = $this->entityTypeManager->getStorage('bb_measurement')->load($id);
    // Without the measurement there is nothing to count; the page offers no
    // options rather than failing.
    if (!$measurement instanceof BbMeasurementInterface) {
      return NULL;
    }
    $period = $this->period($scope, $filters);
    $range = ['from' => $period->from(), 'to' => $period->to()];
    return $this->evaluator->evaluate($measurement, $this->context($scope) + $restrictions, $definition + $range, $this->time->getRequestTime());
  }

  /**
   * The selected period; All time starts at the first closed ticket.
   *
   * @param \Drupal\Core\Entity\EntityInterface $scope
   *   The workspace or project.
   * @param array<string, string|list<string>> $filters
   *   The selected filters; only the period applies.
   */
  public function period(EntityInterface $scope, array $filters): PeriodRange {
    $now = $this->time->getRequestTime();
    $measurement = $this->closedTickets();
    return $this->periodResolver->resolve(
      array_filter(['period' => $filters['period'] ?? ''] + array_intersect_key($filters, array_flip(PeriodResolver::COMPANIONS)), 'is_string'),
      'month',
      $now,
      fn(): ?int => $measurement === NULL ? NULL : $this->evaluator->earliest($measurement, $this->context($scope), $now),
    );
  }

  /**
   * The scope as its named measurement context.
   *
   * @return array<string, \Drupal\Core\Entity\EntityInterface>
   *   The context keyed project, user or workspace.
   */
  private function context(EntityInterface $scope): array {
    $key = match (TRUE) {
      $scope instanceof BbProjectInterface => 'project',
      $scope instanceof UserInterface => 'user',
      default => 'workspace',
    };
    return [$key => $scope];
  }

  /**
   * The IDs of everyone assigned a ticket of the project.
   *
   * @return array<int|string>
   *   User IDs.
   */
  private function assigneeIds(BbProjectInterface $project): array {
    $uids = [];
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('project_id', $project->id())
      ->exists('assignee_user_id')
      ->execute();
    foreach ($storage->loadMultiple($ids) as $ticket) {
      if ($ticket instanceof BbTicketInterface) {
        $uids[] = $ticket->get('assignee_user_id')->target_id;
      }
    }
    return array_values(array_unique($uids));
  }

  /**
   * The closed tickets measurement, if installed.
   */
  private function closedTickets(): ?BbMeasurementInterface {
    $measurement = $this->entityTypeManager->getStorage('bb_measurement')->load('closed_tickets');
    return $measurement instanceof BbMeasurementInterface ? $measurement : NULL;
  }

  /**
   * The workspace's teams, in name order.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The teams.
   */
  private function workspaceTeams(EntityInterface $workspace): array {
    $teams = $this->entityTypeManager->getStorage('bb_team')->loadByProperties(['workspace_id' => $workspace->id()]);
    uasort($teams, static fn(EntityInterface $left, EntityInterface $right): int => strnatcasecmp((string) $left->label(), (string) $right->label()));
    return $teams;
  }

  /**
   * The IDs of the workspace's active members.
   *
   * @return array<int|string>
   *   User IDs.
   */
  private function memberIds(EntityInterface $workspace): array {
    $ids = $this->entityTypeManager->getStorage('og_membership')->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_workspace')
      ->condition('entity_id', $workspace->id())
      ->condition('state', 'active')
      ->execute();
    $uids = [];
    foreach ($this->entityTypeManager->getStorage('og_membership')->loadMultiple($ids) as $membership) {
      if ($membership instanceof OgMembershipInterface) {
        $uids[] = $membership->getOwnerId();
      }
    }
    return $uids;
  }

  /**
   * Each user's first workspace team by name, keyed by user ID.
   *
   * @param \Drupal\Core\Entity\EntityInterface $workspace
   *   The workspace.
   * @param array<\Drupal\Core\Entity\EntityInterface> $users
   *   The users.
   *
   * @return array<int|string, string>
   *   Team names keyed by user ID.
   */
  private function firstTeams(EntityInterface $workspace, array $users): array {
    $teamOf = [];
    $storage = $this->entityTypeManager->getStorage('og_membership');
    foreach ($this->workspaceTeams($workspace) as $team) {
      $ids = $storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('entity_type', 'bb_team')
        ->condition('entity_id', $team->id())
        ->condition('state', 'active')
        ->execute();
      foreach ($storage->loadMultiple($ids) as $membership) {
        $uid = $membership instanceof OgMembershipInterface ? $membership->getOwnerId() : NULL;
        if ($uid !== NULL && isset($users[$uid])) {
          $teamOf[$uid] ??= (string) $team->label();
        }
      }
    }
    return $teamOf;
  }

}
