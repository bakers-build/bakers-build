<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Entity\Submission;

/**
 * Owner-stamped activity input and source-version reconciliation.
 */
final class WorkActivityInput {

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
   * Owner-stamped, deduplicated ingestion; source URLs are never retrieved.
   */
  public function input(array $input): Worklog {
    $owner = $this->records->owner();
    $input = $this->normalize($input);
    $date = $input['work_date'];
    $key = hash('sha256', $input['source_system'] . "\0" . $input['source_key']);
    return $this->mutation->run('owner:' . $owner, function () use ($input, $key, $date): Worklog {
      $submission = isset($input['submission_id']) ? $this->entities->getStorage('bb_track_submission')->loadUnchanged($input['submission_id']) : NULL;
      assert($submission === NULL || $submission instanceof Submission);
      if ($submission?->get('state')->value === 'discarded') {
        throw new \DomainException('Submission is closed.');
      }
      $existing = $this->matchingRow($key, $input);
      if ($existing instanceof Worklog) {
        return $existing;
      }
      if ($submission?->get('state')->value === 'submitted') {
        throw new \DomainException('Submission is closed.');
      }
      return $this->newRow($input, $key, $date, $submission);
    });
  }

  /**
   * The owner's stored row for this source key, if its content is unchanged.
   *
   * @param string $key
   *   The source key hash.
   * @param array<string, mixed> $input
   *   Normalized activity input.
   *
   * @return \Drupal\bb_track\Entity\Worklog|null
   *   The unchanged stored row, or NULL for none.
   */
  private function matchingRow(string $key, array $input): ?Worklog {
    $storage = $this->entities->getStorage('bb_track_worklog');
    $storage->resetCache();
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $this->records->owner())->condition('source_keys', $key)->execute();
    $existing = $ids ? $storage->load(reset($ids)) : NULL;
    assert($existing === NULL || $existing instanceof Worklog);
    if (!$existing instanceof Worklog) {
      return NULL;
    }
    $previous = $existing->sources()[$key] ?? NULL;
    if ($previous === $input) {
      return $existing;
    }
    throw new \DomainException('This source was already recorded. Reconcile the recorded entry explicitly; it will not be rewritten or duplicated.');
  }

  /**
   * Creates and persists the new row for a source key never seen before.
   *
   * @param array<string, mixed> $input
   *   Normalized activity input.
   * @param string $key
   *   The source key hash.
   * @param string $date
   *   The Y-m-d work date.
   * @param \Drupal\bb_track\Entity\Submission|null $submission
   *   The input's submission, or NULL.
   */
  private function newRow(array $input, string $key, string $date, ?Submission $submission): Worklog {
    $account = $this->assignments->assignment($input['project_id'], $input['ticket_id'], $input['account_id'] ?? NULL);
    $entry = Worklog::create([
      'owner_user_id' => $this->records->owner(),
      'source_keys' => [$key],
    ]);
    $entry->set('state', $submission?->get('state')->value === 'proposed' ? 'proposed' : 'recorded')->set('work_date', $date)->set('timezone', $this->records->timezone())
      ->set('description', $input['description'])->set('project_id', $input['project_id'])
      ->set('ticket_id', $input['ticket_id'])->set('duration_seconds', $input['duration_seconds'])
      ->set('account_id', $account['id'])
      ->set('submission_id', $input['submission_id'] ?? NULL)
      ->set('source_data', json_encode([$key => $input], JSON_THROW_ON_ERROR))
      ->set('source_revision', (int) $entry->get('source_revision')->value + 1);
    $this->persist($entry);
    return $entry;
  }

  /**
   * Normalizes bounded source measurements before storage.
   */
  private function normalize(array $input): array {
    $allowed = [
      'source_system',
      'source_key',
      'source_version',
      'work_date',
      'description',
      'project_id',
      'ticket_id',
      'duration_seconds',
      'submission_id',
      'account_id',
    ];
    if (array_diff(array_keys($input), $allowed)) {
      throw new \InvalidArgumentException('Unknown activity field; owner and approval fields are not accepted.');
    }
    if (array_key_exists('submission_id', $input)) {
      $submission = is_int($input['submission_id']) ? Submission::load($input['submission_id']) : NULL;
      if (!$submission || !$submission->access('update')) {
        throw new \DomainException('Submission unavailable.');
      }
    }
    $this->validateIdentity($input);
    WorkTimeRules::date($input['work_date'] ?? '');
    WorkTimeRules::seconds($input['duration_seconds'] ?? NULL);
    $input['ticket_id'] = $input['ticket_id'] ?? NULL;
    $this->validateReferences($input);
    $this->assignments->recordingTarget($input['project_id'], $input['ticket_id']);
    ksort($input);
    return $input;
  }

  /**
   * Requires integer entity ids for project, ticket and billing account.
   */
  private function validateReferences(array $input): void {
    foreach (['project_id', 'ticket_id', 'account_id'] as $field) {
      $value = $input[$field] ?? NULL;
      if (($field === 'project_id' || $value !== NULL) && !is_int($value)) {
        throw new \InvalidArgumentException('Project, ticket and billing account must be valid entity IDs.');
      }
    }
  }

  /**
   * Validates stable external identity and the employee description.
   */
  private function validateIdentity(array $input): void {
    foreach ([
      'source_system',
      'source_key',
      'source_version',
      'description',
    ] as $field) {
      if (!is_string($input[$field] ?? NULL) || trim($input[$field]) === '' || mb_strlen($input[$field]) > ($field === 'description' ? 2000 : 255)) {
        throw new \InvalidArgumentException('Missing or invalid activity identity or description.');
      }
    }
  }

}
