<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;

/**
 * Storage invariants for every ordinary worklog writer.
 */
final class WorklogIntegrity {

  /**
   * Constructs the application service.
   */
  public function __construct(
    private WorkAssignments $assignments,
    private WorkActivityInput $input,
    private WeekSheet $weekSheet,
    private Proposals $proposals,
  ) {}

  /**
   * Storage guard for all ordinary Worklog mutation paths.
   */
  public function guardWorklog(Worklog $entry, ?Worklog $original, bool $deleting): void {
    foreach ([$this->input, $this->weekSheet, $this->proposals] as $operation) {
      if ($operation->mayPersist($entry)) {
        return;
      }
    }
    $state = $entry->get('state')->value;
    if (!in_array($state, ['recorded', 'proposed'], TRUE) || ($original && $original->get('state')->value !== $state)) {
      throw new \DomainException('Only recorded or proposed time is directly editable.');
    }
    if (!$original && !$deleting) {
      $this->guardNewSubmissionRow($entry);
    }
    if ($original) {
      $this->guardUnchangedIdentity($entry, $original);
    }
    if (!$deleting) {
      $this->validateEditableFields($entry, $original);
    }
  }

  /**
   * Rejects a change of ownership or submission assignment on an existing row.
   */
  private function guardUnchangedIdentity(Worklog $entry, Worklog $original): void {
    if ((int) $original->getOwnerId() !== (int) $entry->getOwnerId()) {
      throw new \DomainException('Time ownership cannot change.');
    }
    if (($entry->get('submission_id')->target_id ?? NULL) != ($original->get('submission_id')->target_id ?? NULL)) {
      throw new \DomainException('Submission assignment cannot change.');
    }
  }

  /**
   * A new row joins only an own, open submission in the matching state.
   */
  private function guardNewSubmissionRow(Worklog $entry): void {
    $submission = $entry->get('submission_id')->entity;
    if ($submission === NULL) {
      if ($entry->get('state')->value !== 'recorded') {
        throw new \DomainException('Proposed time belongs to a proposal.');
      }
      return;
    }
    $state = $submission instanceof Submission ? $submission->get('state')->value : NULL;
    if (!in_array($state, ['draft', 'proposed'], TRUE)
      || (int) $submission->getOwnerId() !== (int) $entry->getOwnerId()
      || ($state === 'proposed') !== ($entry->get('state')->value === 'proposed')) {
      throw new \DomainException('Submission unavailable.');
    }
  }

  /**
   * Validates assignment and immutable source provenance on an ordinary save.
   */
  private function validateEditableFields(Worklog $entry, ?Worklog $original): void {
    $this->resolveAccountIfTargetChanged($entry, $original);
    if (!$original && (!$entry->get('source_keys')->isEmpty() || !$entry->get('source_data')->isEmpty())) {
      throw new \DomainException('Source provenance cannot be forged or changed.');
    }
    foreach (['source_data', 'source_keys', 'source_revision', 'voided'] as $field) {
      if ($original ? $entry->get($field)->getValue() !== $original->get($field)->getValue() : !empty($entry->get($field)->value)) {
        throw new \DomainException('Source provenance cannot be forged or changed.');
      }
    }
  }

  /**
   * Fills an empty account from the target, checks an explicitly chosen one.
   *
   * An unchanged target with an unchanged account is left alone: a
   * historical entry's project or ticket may since have been deleted, which
   * the resolver cannot load, and its account may since have been archived.
   * A chosen account is never silently swapped: one that does not fit the
   * (new) target is rejected instead.
   */
  private function resolveAccountIfTargetChanged(Worklog $entry, ?Worklog $original): void {
    $project_id = (int) $entry->get('project_id')->target_id;
    $ticket_id = $entry->get('ticket_id')->target_id ? (int) $entry->get('ticket_id')->target_id : NULL;
    $account_id = $entry->get('account_id')->target_id ? (int) $entry->get('account_id')->target_id : NULL;
    if ($account_id === NULL) {
      $entry->set('account_id', $this->assignments->resolveAccountId($project_id, $ticket_id));
      return;
    }
    $unchanged = $original instanceof Worklog
      && (int) $original->get('project_id')->target_id === $project_id
      && (int) $original->get('ticket_id')->target_id === (int) $ticket_id
      && (int) $original->get('account_id')->target_id === $account_id;
    if (!$unchanged) {
      $this->assignments->resolveAccountId($project_id, $ticket_id, $account_id);
    }
  }

}
