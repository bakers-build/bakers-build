<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\Query\QueryAggregateInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;

/**
 * Week totals of the time calendar from the authorized dataset.
 *
 * One access-checked aggregate entity query per call, with the selection's
 * conditions, so totals match the list across every page and query access
 * bounds them exactly like the rows.
 */
final class WorklogAggregates {

  use StringTranslationTrait;

  /**
   * Constructs the aggregates.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly WorklogCalendar $calendar,
  ) {}

  /**
   * Seconds per day of the selected week.
   *
   * @return array<string, int>
   *   Seven Y-m-d keys, Monday to Sunday.
   */
  public function secondsByDay(WorklogSelection $selection): array {
    $days = $this->emptyWeek($selection);
    if (!$selection->valid) {
      return $days;
    }
    foreach ($this->baseQuery($selection)->groupBy('work_date')->execute() as $row) {
      $days[(string) $row['work_date']] = (int) $row['duration_seconds_sum'];
    }
    return $days;
  }

  /**
   * The viewer's proposed, not yet recorded seconds of the selected week.
   */
  public function proposedSeconds(WorklogSelection $selection): int {
    if (!$selection->isOwn()) {
      return 0;
    }
    $sum = 0;
    foreach ($this->baseQuery($selection, $selection->proposedConditions())->execute() as $row) {
      $sum += (int) $row['duration_seconds_sum'];
    }
    return $sum;
  }

  /**
   * Week grid rows by person or by project and ticket.
   *
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param string $row_key
   *   Either 'person' or 'project_ticket'.
   *
   * @return list<array{key: string, filter: array<string, int>, label: string, days: array<string, int>, total: int}>
   *   Rows sorted by label.
   */
  public function grid(WorklogSelection $selection, string $row_key): array {
    if (!$selection->valid) {
      return [];
    }
    $fields = $row_key === 'person' ? ['owner_user_id'] : ['project_id', 'ticket_id'];
    $query = $this->baseQuery($selection)->groupBy('work_date');
    foreach ($fields as $field) {
      $query->groupBy($field);
    }
    $rows = [];
    foreach ($query->execute() as $result) {
      $key = implode(':', array_map(static fn (string $field): string => (string) ($result[$field] ?? ''), $fields));
      $rows[$key] ??= $this->gridRow($selection, $key, $result, $row_key);
      $rows[$key]['days'][(string) $result['work_date']] = (int) $result['duration_seconds_sum'];
    }
    foreach ($rows as &$row) {
      $row['total'] = array_sum($row['days']);
    }
    unset($row);
    usort($rows, static fn (array $a, array $b): int => strnatcasecmp($a['label'], $b['label']));
    return $rows;
  }

  /**
   * An empty grid row with its label and day filter.
   *
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param string $key
   *   Row key.
   * @param array<string, mixed> $result
   *   Aggregate result row.
   * @param string $row_key
   *   Either 'person' or 'project_ticket'.
   *
   * @return array{key: string, filter: array<string, int>, label: string, days: array<string, int>, total: int}
   *   Row.
   */
  private function gridRow(WorklogSelection $selection, string $key, array $result, string $row_key): array {
    [$label, $filter] = $row_key === 'person'
      ? $this->personTarget((int) $result['owner_user_id'])
      : $this->projectTarget((int) ($result['project_id'] ?? 0), (int) ($result['ticket_id'] ?? 0));
    return [
      'key' => $key,
      'filter' => $filter,
      'label' => $label,
      'days' => $this->emptyWeek($selection),
      'total' => 0,
    ];
  }

  /**
   * Label and filter of a person row.
   *
   * @return array{0: string, 1: array<string, int>}
   *   Label and day filter.
   */
  private function personTarget(int $uid): array {
    $user = $this->entityTypeManager->getStorage('user')->load($uid);
    return [
      $user instanceof UserInterface ? (string) $user->getDisplayName() : (string) $this->t('Unknown person'),
      ['person' => $uid],
    ];
  }

  /**
   * Label and filter of a project/ticket row; unresolved targets stay safe.
   *
   * @return array{0: string, 1: array<string, int>}
   *   Label and day filter.
   */
  private function projectTarget(int $project_id, int $ticket_id): array {
    $project = $project_id > 0 ? $this->entityTypeManager->getStorage('bb_project')->load($project_id) : NULL;
    if (!$project instanceof BbProjectInterface || !$project->access('view')) {
      return [(string) $this->t('Unresolved project'), []];
    }
    $label = $this->calendar->projectLabel($project);
    $filter = ['project' => $project_id];
    if ($ticket_id > 0) {
      $ticket = $this->entityTypeManager->getStorage('bb_ticket')->load($ticket_id);
      $readable = $ticket instanceof BbTicketInterface && $ticket->access('view');
      $label .= ' · ' . ($readable ? $this->calendar->ticketLabel($ticket) : (string) $this->t('Unresolved ticket'));
      if ($readable) {
        $filter['ticket'] = $ticket_id;
      }
    }
    return [$label, $filter];
  }

  /**
   * Seven zero days of the selected week.
   *
   * @return array<string, int>
   *   Y-m-d keys.
   */
  private function emptyWeek(WorklogSelection $selection): array {
    $days = [];
    $monday = new \DateTimeImmutable($selection->weekStart);
    for ($i = 0; $i < 7; $i++) {
      $days[$monday->modify("+$i days")->format('Y-m-d')] = 0;
    }
    return $days;
  }

  /**
   * Access-checked SUM over the selected week and conditions.
   *
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param list<array{0: string, 1: mixed, 2: string}>|null $conditions
   *   Conditions other than the selection's recorded ones.
   */
  private function baseQuery(WorklogSelection $selection, ?array $conditions = NULL): QueryAggregateInterface {
    $query = $this->entityTypeManager->getStorage('bb_track_worklog')->getAggregateQuery()
      ->accessCheck(TRUE)
      ->condition('work_date', $selection->weekStart, '>=')
      ->condition('work_date', $selection->weekEnd, '<')
      ->aggregate('duration_seconds', 'SUM');
    foreach ($conditions ?? $selection->conditions() as [$field, $value, $operator]) {
      $query->condition($field, $value, $operator);
    }
    return $query;
  }

}
