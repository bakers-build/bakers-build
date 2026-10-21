<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Form\WorklogFormLayout;

/**
 * Reads and saves the owner's week as a grid of day cells.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class WeekSheet {

  use WorkTimePersistence;

  /**
   * Constructs the application service.
   */
  public function __construct(
    private EntityTypeManagerInterface $entities,
    private WorkTimeMutation $mutation,
    private WorkTimeRecords $records,
    private WorkAssignments $assignments,
    private WorkTargetOptions $targets,
  ) {}

  /**
   * The owner's live rows of a week, grouped by cell key.
   *
   * @return array<string, list<\Drupal\bb_track\Entity\Worklog>>
   *   Rows keyed by WeekSheetCell::key(), in key order.
   */
  public function cells(int $owner, string $week_start, ?int $submission_id): array {
    $end = (new \DateTimeImmutable($week_start))->modify('+6 days')->format('Y-m-d');
    $query = $this->entities->getStorage('bb_track_worklog')->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $owner)
      ->condition('voided', 0)
      ->condition('state', ['recorded', 'approved', 'proposed'], 'IN')
      ->condition('work_date', [$week_start, $end], 'BETWEEN');
    $cells = [];
    $selected = [];
    foreach ($this->entities->getStorage('bb_track_worklog')->loadMultiple($query->execute()) as $row) {
      assert($row instanceof Worklog);
      $cells[self::keyOf($row)][] = $row;
      if ($submission_id === NULL || (int) $row->get('submission_id')->target_id === $submission_id) {
        $selected[self::keyOf($row)] = TRUE;
      }
    }
    // A submission's cells keep their other entries: a shared day stays locked.
    $cells = array_intersect_key($cells, $selected);
    ksort($cells);
    return $cells;
  }

  /**
   * The cell key of a stored row.
   */
  public static function keyOf(Worklog $row): string {
    return $row->get('work_date')->value . ':' . (int) $row->get('project_id')->target_id . ':' . (int) $row->get('ticket_id')->target_id;
  }

  /**
   * Applies every cell, or nothing when any cell is invalid.
   *
   * @param list<\Drupal\bb_track\WeekSheetCell> $cells
   *   The submitted cells.
   * @param list<string> $shown
   *   Keys of the cells the grid showed; their proposed entries that no
   *   posted cell carried (locked cells) are booked as well.
   * @param int|null $submission_id
   *   Limits that booking to one submission.
   *
   * @return array{errors: array<string, string>, changed: int, recorded: int}
   *   Errors keyed by cell key; when non-empty nothing was written.
   */
  public function save(array $cells, array $shown = [], ?int $submission_id = NULL): array {
    $owner = $this->records->owner();
    return $this->mutation->run('owner:' . $owner, function () use ($cells, $owner, $shown, $submission_id): array {
      $errors = [];
      $plan = [];
      foreach ($cells as $cell) {
        try {
          $plan[] = $this->planCell($cell, $owner, $submission_id);
        }
        catch (\InvalidArgumentException | \DomainException $error) {
          $errors[$cell->key()] = $error->getMessage();
        }
      }
      $plan = [...$plan, ...$this->planUnpostedProposals($owner, $shown, $submission_id, $plan, $errors)];
      if ($errors !== []) {
        return ['errors' => $errors, 'changed' => 0, 'recorded' => 0];
      }
      return ['errors' => []] + $this->apply($plan);
    });
  }

  /**
   * Writes a validated plan.
   *
   * @param list<array{0: string, 1: ?\Drupal\bb_track\Entity\Worklog, 2: int}> $plan
   *   Operation, row and seconds per cell.
   *
   * @return array{changed: int, recorded: int}
   *   Counts.
   */
  private function apply(array $plan): array {
    $storage = $this->entities->getStorage('bb_track_worklog');
    $changed = $recorded = 0;
    $proposals = $joins = [];
    foreach ($plan as [$operation, $row, $seconds]) {
      if ($operation === 'noop' || $row === NULL) {
        continue;
      }
      $changed++;
      if ($operation === 'create' && $row->get('submission_id')->target_id) {
        $joins[] = [$row, $seconds];
        continue;
      }
      if ($operation === 'delete') {
        $storage->delete([$row]);
        continue;
      }
      if ($row->get('state')->value === 'proposed') {
        $row->set('state', 'recorded');
        $proposals[(int) $row->get('submission_id')->target_id] = TRUE;
        $recorded++;
      }
      $row->set('duration_seconds', $seconds);
      $this->persist($row);
    }
    foreach (array_keys($proposals) as $id) {
      $this->closeBookedProposal($id);
    }
    $this->join($joins);
    return ['changed' => $changed, 'recorded' => $recorded];
  }

  /**
   * Stores rows added under a submission once its shown proposals are booked.
   *
   * A proposal still open in another week keeps them proposed.
   *
   * @param list<array{0: \Drupal\bb_track\Entity\Worklog, 1: int}> $joins
   *   New rows and their seconds.
   */
  private function join(array $joins): void {
    foreach ($joins as [$row, $seconds]) {
      $submission = $this->entities->getStorage('bb_track_submission')->loadUnchanged($row->get('submission_id')->target_id);
      $row->set('state', $submission instanceof Submission && $submission->get('state')->value === 'proposed' ? 'proposed' : 'recorded');
      $row->set('duration_seconds', $seconds);
      $this->persist($row);
    }
  }

  /**
   * A proposal whose rows are all booked becomes an ordinary draft.
   */
  private function closeBookedProposal(int $id): void {
    $submission = $this->entities->getStorage('bb_track_submission')->loadUnchanged($id);
    $open = (int) $this->entities->getStorage('bb_track_worklog')->getQuery()->accessCheck(FALSE)
      ->condition('submission_id', $id)->condition('state', 'proposed')->condition('voided', 0)
      ->count()->execute();
    if ($submission instanceof Submission && $submission->get('state')->value === 'proposed' && $open === 0) {
      $submission->serviceTransition = TRUE;
      $submission->set('state', 'draft')->save();
    }
  }

  /**
   * Books the shown cells' proposed entries that no posted cell carried.
   *
   * @param int $owner
   *   The saving owner.
   * @param list<string> $shown
   *   Keys of the cells the grid showed.
   * @param int|null $submission_id
   *   Limits the booking to one submission.
   * @param list<array{0: string, 1: ?\Drupal\bb_track\Entity\Worklog, 2: int}> $plan
   *   The posted cells' plan.
   * @param array<string, string> $errors
   *   Errors by cell key, extended for unbookable entries.
   *
   * @return list<array{0: string, 1: \Drupal\bb_track\Entity\Worklog, 2: int}>
   *   One booking per unposted proposed entry.
   */
  private function planUnpostedProposals(int $owner, array $shown, ?int $submission_id, array $plan, array &$errors): array {
    $planned = [];
    foreach ($plan as [, $row]) {
      if ($row instanceof Worklog && !$row->isNew()) {
        $planned[(int) $row->id()] = TRUE;
      }
    }
    $bookings = [];
    foreach ($shown as $key) {
      [$date, $project, $ticket] = explode(':', $key);
      $rows = $this->stored(new WeekSheetCell($date, (int) $project, (int) $ticket ?: NULL, '', NULL, NULL), $owner);
      $unposted = array_filter($rows, fn (Worklog $row): bool => $this->isUnpostedProposal($row, $planned, $submission_id));
      foreach ($unposted as $row) {
        try {
          $ticket = $row->get('ticket_id')->target_id;
          $this->assignments->recordingTarget((int) $row->get('project_id')->target_id, $ticket ? (int) $ticket : NULL);
          $bookings[] = ['update', $row, (int) $row->get('duration_seconds')->value];
        }
        catch (\DomainException $error) {
          $errors[$key] = $error->getMessage();
        }
      }
    }
    return $bookings;
  }

  /**
   * Whether a stored row is a proposed entry no posted cell planned.
   *
   * @param \Drupal\bb_track\Entity\Worklog $row
   *   The stored row.
   * @param array<int, bool> $planned
   *   Ids of rows the posted cells already plan.
   * @param int|null $submission_id
   *   The submission the booking is limited to.
   */
  private function isUnpostedProposal(Worklog $row, array $planned, ?int $submission_id): bool {
    return $row->get('state')->value === 'proposed'
      && !isset($planned[(int) $row->id()])
      && ($submission_id === NULL || (int) $row->get('submission_id')->target_id === $submission_id);
  }

  /**
   * Validates one cell against stored state and returns its operation.
   *
   * @return array{0: string, 1: ?\Drupal\bb_track\Entity\Worklog, 2: int}
   *   Operation (noop, create, update, delete), row and seconds.
   */
  private function planCell(WeekSheetCell $cell, int $owner, ?int $submission_id): array {
    WorkTimeRules::date($cell->date);
    $rows = $this->stored($cell, $owner);
    if (count($rows) > 1) {
      throw new \DomainException('This day already has several entries. Edit them one by one.');
    }
    $row = $rows[0] ?? NULL;
    $seconds = $cell->typed === '' ? 0 : $this->seconds($cell->typed);
    return $cell->entryId === NULL
      ? $this->planNewCell($cell, $owner, $row, $seconds, $submission_id)
      : $this->planExistingCell($cell, $row, $seconds);
  }

  /**
   * Plans a cell posted without an entry id: create, or a replayed noop.
   *
   * @return array{0: string, 1: ?\Drupal\bb_track\Entity\Worklog, 2: int}
   *   Operation (noop, create), row and seconds.
   */
  private function planNewCell(WeekSheetCell $cell, int $owner, ?Worklog $row, int $seconds, ?int $submission_id): array {
    if ($row === NULL) {
      return $seconds === 0 ? ['noop', NULL, 0] : ['create', $this->newRow($cell, $owner, $submission_id), $seconds];
    }
    // A replayed save of a cell that was empty when rendered.
    if ((int) $row->get('duration_seconds')->value === $seconds && $row->get('state')->value === 'recorded') {
      return ['noop', NULL, 0];
    }
    throw new \DomainException('This entry changed. Reload the week.');
  }

  /**
   * Refuses approved rows and rows the owner may no longer change.
   */
  private function guardChangeable(Worklog $row, int $seconds): void {
    if ($row->get('state')->value === 'approved' || !$row->access($seconds === 0 ? 'delete' : 'update')) {
      throw new \DomainException('This entry can no longer be changed.');
    }
  }

  /**
   * Whether a repeated post finds its own result already stored.
   */
  private function isReplay(WeekSheetCell $cell, ?Worklog $row, int $seconds): bool {
    if ($row === NULL) {
      return $seconds === 0;
    }
    return (int) $row->id() === $cell->entryId
      && $row->version() !== $cell->version
      && $row->get('state')->value === 'recorded'
      && (int) $row->get('duration_seconds')->value === $seconds;
  }

  /**
   * Plans a cell posted with an entry id: update, delete, or a noop.
   *
   * @return array{0: string, 1: ?\Drupal\bb_track\Entity\Worklog, 2: int}
   *   Operation (noop, update, delete), row and seconds.
   */
  private function planExistingCell(WeekSheetCell $cell, ?Worklog $row, int $seconds): array {
    if ($this->isReplay($cell, $row, $seconds)) {
      return ['noop', NULL, 0];
    }
    if ($row === NULL || (int) $row->id() !== $cell->entryId || $row->version() !== $cell->version) {
      throw new \DomainException('This entry changed. Reload the week.');
    }
    $this->guardChangeable($row, $seconds);
    $state = $row->get('state')->value;
    if ($seconds === 0) {
      return ['delete', $row, 0];
    }
    if ($state === 'recorded' && (int) $row->get('duration_seconds')->value === $seconds) {
      return ['noop', NULL, 0];
    }
    return ['update', $row, $seconds];
  }

  /**
   * The owner's live rows in the cell.
   *
   * @return list<\Drupal\bb_track\Entity\Worklog>
   *   Rows.
   */
  private function stored(WeekSheetCell $cell, int $owner): array {
    $storage = $this->entities->getStorage('bb_track_worklog');
    $query = $storage->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $owner)
      ->condition('voided', 0)
      ->condition('work_date', $cell->date)
      ->condition('project_id', $cell->projectId);
    $cell->ticketId === NULL ? $query->notExists('ticket_id') : $query->condition('ticket_id', $cell->ticketId);
    $ids = $query->execute();
    $storage->resetCache($ids);
    return array_values(array_filter(
      $storage->loadMultiple($ids),
      static fn (object $entity): bool => $entity instanceof Worklog,
    ));
  }

  /**
   * Parses the typed duration.
   */
  private function seconds(string $typed): int {
    $seconds = WorklogFormLayout::parseDuration($typed);
    if ($seconds === NULL) {
      throw new \InvalidArgumentException((string) WorkTimeRules::durationError($typed));
    }
    return $seconds;
  }

  /**
   * A new recorded row for an empty cell, after checking the target.
   *
   * Added while an open submission is reviewed, the row joins it.
   */
  private function newRow(WeekSheetCell $cell, int $owner, ?int $submission_id): Worklog {
    $submission = $submission_id === NULL ? NULL : $this->entities->getStorage('bb_track_submission')->load($submission_id);
    $open = $submission instanceof Submission && in_array($submission->get('state')->value, ['draft', 'proposed'], TRUE);
    [$project] = $this->assignments->recordingTarget($cell->projectId, $cell->ticketId);
    $account = $this->assignments->assignment($cell->projectId, $cell->ticketId)['id'];
    $description = $cell->ticketId === NULL
      ? (string) $project->label()
      : (string) $this->targets->ticketOf($cell->ticketId, $cell->projectId);
    return Worklog::create([
      'owner_user_id' => $owner,
      'work_date' => $cell->date,
      'timezone' => $this->records->timezone(),
      'description' => $description,
      'project_id' => $cell->projectId,
      'ticket_id' => $cell->ticketId,
      'account_id' => $account,
      'derivation' => 'manual',
      'state' => 'recorded',
      'submission_id' => $open ? $submission_id : NULL,
    ]);
  }

}
