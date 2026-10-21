<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;

/**
 * Reviews, records or discards an owner's complete AI proposal.
 */
final class Proposals {

  use WorkTimePersistence;

  /**
   * Constructs the application service.
   */
  public function __construct(
    private EntityTypeManagerInterface $entities,
    private WorkTimeMutation $mutation,
    private WorkTimeRecords $records,
    private WorkAssignments $assignments,
  ) {}

  /**
   * Live entries of the owned submission, in chronological order.
   *
   * @return array<int, \Drupal\bb_track\Entity\Worklog>
   *   Entries keyed by id.
   */
  public function rows(Submission $submission): array {
    $fresh = $this->reloadOwn($submission, $this->records->owner());
    $storage = $this->entities->getStorage('bb_track_worklog');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('submission_id', $fresh->id())
      ->condition('owner_user_id', $fresh->getOwnerId())
      ->condition('voided', 0)->sort('work_date')->sort('id')->execute();
    $storage->resetCache($ids);
    /** @var array<int, \Drupal\bb_track\Entity\Worklog> $rows */
    $rows = $storage->loadMultiple($ids);
    return $rows;
  }

  /**
   * Validates and records a complete proposal under its owner's lock.
   *
   * @param \Drupal\bb_track\Entity\Submission $submission
   *   The owned proposal.
   * @param array<int, array> $changes
   *   Duration, description, project and ticket per rendered entry.
   * @param array<int, string> $versions
   *   Version tokens of every rendered entry.
   *
   * @return int
   *   Newly recorded entries, or zero for an unchanged replay.
   */
  public function save(Submission $submission, array $changes, array $versions): int {
    $owner = $this->records->owner();
    return $this->mutation->run('owner:' . $owner, function () use ($submission, $changes, $versions, $owner): int {
      $fresh = $this->reloadOwn($submission, $owner);
      $rows = $this->rows($fresh);
      $this->checkRowSet($rows, $changes, $versions);
      if ($fresh->get('state')->value === 'draft' && $this->isReplay($rows, $changes)) {
        return 0;
      }
      if ($fresh->get('state')->value !== 'proposed' || $rows === []) {
        throw new \DomainException('This proposal is no longer open or has no entries. Reload the submission.');
      }
      $plan = [];
      foreach ($rows as $id => $row) {
        if ($row->version() !== $versions[$id] || !$row->access('update')) {
          throw new \DomainException('An entry changed or is no longer editable. Reload the submission.');
        }
        $plan[] = $this->prepareRow($row, $changes[$id]);
      }
      $recorded = 0;
      foreach ($plan as $row) {
        if ($row->get('state')->value === 'proposed') {
          $row->set('state', 'recorded');
          $recorded++;
        }
        $this->persist($row);
      }
      $fresh->serviceTransition = TRUE;
      $fresh->set('state', 'draft')->save();
      return $recorded;
    });
  }

  /**
   * Requires exactly the reviewed entries, including concurrent additions.
   */
  private function checkRowSet(array $rows, array $changes, array $versions): void {
    $ids = array_keys($rows);
    $changed = array_keys($changes);
    $seen = array_keys($versions);
    sort($ids);
    sort($changed);
    sort($seen);
    if ($ids !== $changed || $ids !== $seen) {
      throw new \DomainException('The submission entries changed. Reload the submission.');
    }
  }

  /**
   * An unchanged repeated booking never writes again.
   */
  private function isReplay(array $rows, array $changes): bool {
    foreach ($rows as $id => $row) {
      $change = $changes[$id];
      if ($row->get('state')->value !== 'recorded'
        || (int) $row->get('duration_seconds')->value !== $change['duration_seconds']
        || $row->get('description')->value !== $change['description']
        || (int) $row->get('project_id')->target_id !== $change['project_id']
        || (int) $row->get('ticket_id')->target_id !== (int) $change['ticket_id']
        || (isset($change['account_id']) && (int) $row->get('account_id')->target_id !== (int) $change['account_id'])) {
        return FALSE;
      }
    }
    return TRUE;
  }

  /**
   * Validates a detached copy so failed validation cannot alter cached rows.
   */
  private function prepareRow(Worklog $row, array $change): Worklog {
    WorkTimeRules::seconds($change['duration_seconds']);
    $this->assignments->recordingTarget($change['project_id'], $change['ticket_id']);
    $copy = clone $row;
    foreach (['duration_seconds', 'description', 'project_id', 'ticket_id'] as $field) {
      $copy->set($field, $change[$field]);
    }
    // The reviewer's choice is checked against the (possibly reassigned)
    // target; without one the target's own account is resolved.
    $copy->set('account_id', $this->assignments->assignment($change['project_id'], $change['ticket_id'], $change['account_id'] ?? NULL)['id']);
    $violations = $copy->validate();
    if ($violations->count() > 0) {
      throw new \DomainException((string) $violations->get(0)->getMessage());
    }
    return $copy;
  }

  /**
   * Removes the proposed rows and closes the proposal.
   *
   * @return int
   *   Rows removed; 0 when the proposal was already closed.
   */
  public function discard(Submission $submission): int {
    $owner = $this->records->owner();
    return $this->mutation->run('owner:' . $owner, function () use ($submission, $owner): int {
      $fresh = $this->reloadOwn($submission, $owner);
      if ($fresh->get('state')->value !== 'proposed') {
        return 0;
      }
      $storage = $this->entities->getStorage('bb_track_worklog');
      $rows = $storage->loadByProperties([
        'submission_id' => $fresh->id(),
        'state' => 'proposed',
        'voided' => 0,
      ]);
      // Sourced rows become voided tombstones, so a retry cannot revive them.
      $storage->delete($rows);
      $fresh->serviceTransition = TRUE;
      $fresh->set('state', 'discarded')->save();
      return count($rows);
    });
  }

  /**
   * Loads the stored submission and requires the current owner.
   */
  private function reloadOwn(Submission $submission, int $owner): Submission {
    $storage = $this->entities->getStorage('bb_track_submission');
    $fresh = $storage->loadUnchanged($submission->id());
    if (!$fresh instanceof Submission || (int) $fresh->getOwnerId() !== $owner) {
      throw new \DomainException('Submission unavailable.');
    }
    return $fresh;
  }

}
