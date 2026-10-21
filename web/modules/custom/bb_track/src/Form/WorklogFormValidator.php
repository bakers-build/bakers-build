<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Access\WorklogFormAccess;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkTimeRules;

/**
 * Field and assignment checks for the native time form.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class WorklogFormValidator {

  use StringTranslationTrait;

  /**
   * Constructs the validator.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbWorkspaceReadScopeInterface $readScope,
  ) {
  }

  /**
   * Validates submitted scalars and assignment targets.
   */
  public function validate(
    FormStateInterface $form_state,
    ?Worklog $entry,
    AccountInterface $account,
  ): void {
    $this->validateDuration($form_state);
    $this->validateDescription($form_state);
    $this->validateDate($form_state);
    $this->validateTargets($form_state, $entry, $account);
  }

  /**
   * Revalidates caller context for a new entry.
   *
   * @param array<string, mixed> $query
   *   The request query.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   Acting account.
   *
   * @return array{date: ?string, project: ?\Drupal\bb_core\Entity\BbProjectInterface, ticket: ?\Drupal\bb_core\Entity\BbTicketInterface, submission: ?\Drupal\bb_track\Entity\Submission, notices: list<string>}
   *   Permitted context and notices for dropped values.
   */
  public function prefill(array $query, AccountInterface $account): array {
    $context = ['date' => NULL, 'project' => NULL, 'ticket' => NULL, 'submission' => NULL, 'notices' => []];
    $context['date'] = $this->prefillDate($query['date'] ?? NULL);
    [$context['project'], $notice] = $this->prefillProject($query['project'] ?? NULL, $account);
    if ($notice !== NULL) {
      $context['notices'][] = $notice;
    }
    [$context['ticket'], $notice] = $this->prefillTicket($query['ticket'] ?? NULL, $context['project'], $account);
    if ($notice !== NULL) {
      $context['notices'][] = $notice;
    }
    $context['submission'] = $this->prefillSubmission($query['submission'] ?? NULL, $account);
    return $context;
  }

  /**
   * A valid calendar date from a query value, or NULL.
   */
  private function prefillDate(mixed $date): ?string {
    if (!is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
      return NULL;
    }
    $valid = checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4));
    return $valid ? $date : NULL;
  }

  /**
   * The assignable project from a query value, with a notice when dropped.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbProjectInterface|null, 1: string|null}
   *   The project, and a notice when the suggestion was dropped.
   */
  private function prefillProject(mixed $raw, AccountInterface $account): array {
    $project_id = $this->positiveId($raw);
    if ($project_id === NULL) {
      return [NULL, NULL];
    }
    if (!$this->canAssignProject($project_id, $account)) {
      return [NULL, (string) $this->t('The suggested project is not available.')];
    }
    $project = $this->entityTypeManager->getStorage('bb_project')->load($project_id);
    return [$project instanceof BbProjectInterface ? $project : NULL, NULL];
  }

  /**
   * The matching ticket from a query value, with a notice when dropped.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbTicketInterface|null, 1: string|null}
   *   The ticket, and a notice when the suggestion was dropped.
   */
  private function prefillTicket(mixed $raw, ?BbProjectInterface $project, AccountInterface $account): array {
    $ticket_id = $this->positiveId($raw);
    if ($ticket_id === NULL) {
      return [NULL, NULL];
    }
    if (!$project instanceof BbProjectInterface || !$this->ticketBelongs($ticket_id, (int) $project->id(), $account)) {
      return [NULL, (string) $this->t('The suggested ticket is not available.')];
    }
    $ticket = $this->entityTypeManager->getStorage('bb_ticket')->load($ticket_id);
    return [$ticket instanceof BbTicketInterface ? $ticket : NULL, NULL];
  }

  /**
   * The caller's own draft or proposed submission, or NULL.
   */
  private function prefillSubmission(mixed $uuid, AccountInterface $account): ?Submission {
    if (!is_string($uuid) || $uuid === '') {
      return NULL;
    }
    $found = $this->entityTypeManager->getStorage('bb_track_submission')->loadByProperties(['uuid' => $uuid]);
    $submission = reset($found);
    if ($submission instanceof Submission
      && (int) $submission->getOwnerId() === (int) $account->id()
      && in_array($submission->get('state')->value, ['draft', 'proposed'], TRUE)) {
      return $submission;
    }
    return NULL;
  }

  /**
   * A positive integer id from a query value, or NULL.
   */
  private function positiveId(mixed $value): ?int {
    return is_string($value) && preg_match('/^[1-9]\d*$/', $value) ? (int) $value : NULL;
  }

  /**
   * Parses H:MM into stored seconds.
   */
  private function validateDuration(FormStateInterface $form_state): void {
    $raw = $form_state->getValue('duration');
    $seconds = WorklogFormLayout::parseDuration($raw);
    if ($seconds === NULL) {
      $form_state->setErrorByName('duration', WorkTimeRules::durationError($raw));
      return;
    }
    $form_state->set('duration_seconds', $seconds);
  }

  /**
   * Trims and bounds the description.
   */
  private function validateDescription(FormStateInterface $form_state): void {
    $description = trim((string) $form_state->getValue('description'));
    $form_state->set('trimmed_description', $description);
    if ($description === '') {
      $form_state->setErrorByName('description', $this->t('Enter a description of the work.'));
      return;
    }
    if (mb_strlen($description) > 2000) {
      $form_state->setErrorByName(
        'description',
        $this->t('Description cannot exceed 2000 characters.'),
      );
    }
  }

  /**
   * Requires a real calendar date.
   */
  private function validateDate(FormStateInterface $form_state): void {
    $value = (string) $form_state->getValue('work_date');
    $date = \DateTimeImmutable::createFromFormat('Y-m-d', $value);
    $errors = \DateTimeImmutable::getLastErrors();
    $valid = $value !== ''
      && $date !== FALSE
      && $date->format('Y-m-d') === $value
      && ($errors === FALSE || (($errors['warning_count'] ?? 0) === 0 && ($errors['error_count'] ?? 0) === 0));
    if (!$valid) {
      $form_state->setErrorByName(
        'work_date',
        $this->t('Enter a real calendar date as YYYY-MM-DD.'),
      );
    }
  }

  /**
   * Resolves and checks project and ticket assignment.
   */
  private function validateTargets(
    FormStateInterface $form_state,
    ?Worklog $entry,
    AccountInterface $account,
  ): void {
    $project_id = $this->submittedId($form_state->getValue('project'))
      ?? $form_state->get('retained_project_id');
    // No ticket removes an unresolved ticket; only its own option keeps it.
    $ticket_id = in_array(WorklogFormLayout::RETAINED, (array) $form_state->getValue('ticket'), TRUE)
      ? $form_state->get('retained_ticket_id')
      : $this->submittedId($form_state->getValue('ticket'));
    $form_state->set('project_id', $project_id);
    $form_state->set('ticket_id', $ticket_id);
    $project_changed = $this->projectChanged($entry, $project_id);
    $this->validateProject($form_state, $account, $project_id, $project_changed);
    $this->validateTicket($form_state, $entry, $account, $project_id, $ticket_id, $project_changed);
  }

  /**
   * Whether the posted project differs from the stored one.
   */
  private function projectChanged(?Worklog $entry, mixed $project_id): bool {
    if (!$entry instanceof Worklog) {
      return TRUE;
    }
    return (int) $entry->get('project_id')->target_id !== (int) $project_id;
  }

  /**
   * Requires an assignable project, or a retained unresolved id.
   */
  private function validateProject(
    FormStateInterface $form_state,
    AccountInterface $account,
    mixed $project_id,
    bool $project_changed,
  ): void {
    if ($project_id === NULL || (int) $project_id === 0) {
      $form_state->setErrorByName(
        'project',
        $this->t('Select a project you can record time against.'),
      );
      return;
    }
    if ($project_changed && !$this->canAssignProject((int) $project_id, $account)) {
      $form_state->setErrorByName(
        'project',
        $this->t('Select a project you can record time against.'),
      );
    }
  }

  /**
   * Requires a new ticket to belong to the chosen project.
   */
  private function validateTicket(
    FormStateInterface $form_state,
    ?Worklog $entry,
    AccountInterface $account,
    mixed $project_id,
    mixed $ticket_id,
    bool $project_changed,
  ): void {
    if ($ticket_id === NULL) {
      return;
    }
    $stored_ticket = $entry instanceof Worklog
      ? (int) $entry->get('ticket_id')->target_id
      : 0;
    $ticket_changed = (int) $ticket_id !== $stored_ticket || $project_changed;
    if ($ticket_changed && !$this->ticketBelongs((int) $ticket_id, (int) $project_id, $account)) {
      $form_state->setErrorByName(
        'ticket',
        $this->t('Select a ticket that belongs to the chosen project.'),
      );
    }
  }

  /**
   * Whether a project is currently assignable for the actor.
   */
  private function canAssignProject(int $id, AccountInterface $account): bool {
    $project = $this->entityTypeManager->getStorage('bb_project')->load($id);
    if (!$project instanceof BbProjectInterface) {
      return FALSE;
    }
    $allowed = $this->readScope->projectIds($account);
    if (!in_array((int) $project->id(), $allowed, TRUE) || !$project->access('view', $account)) {
      return FALSE;
    }
    $group = $project->getGroup();
    if (!$group instanceof BbGroupInterface) {
      return FALSE;
    }
    $workspace = $group->get('workspace_id')->entity;
    return $workspace instanceof BbWorkspaceInterface
      && WorklogFormAccess::canRecord($account, $workspace);
  }

  /**
   * Whether a ticket belongs to the selected project and is visible.
   */
  private function ticketBelongs(int $ticket_id, int $project_id, AccountInterface $account): bool {
    $ticket = $this->entityTypeManager->getStorage('bb_ticket')->load($ticket_id);
    if (!$ticket instanceof BbTicketInterface || !$ticket->access('view', $account)) {
      return FALSE;
    }
    $project = $ticket->getProject();
    if (!$project instanceof BbProjectInterface || (int) $project->id() !== $project_id) {
      return FALSE;
    }
    $allowed = $this->readScope->projectIds($account);
    return in_array((int) $project->id(), $allowed, TRUE);
  }

  /**
   * Reads a numeric entity id from an autocomplete value.
   */
  private function submittedId(mixed $value): ?int {
    if (is_array($value) && array_is_list($value)) {
      $value = $value[0] ?? NULL;
    }
    if (is_string($value) && preg_match('/\((\d+)\)\s*$/', $value, $matches)) {
      return (int) $matches[1];
    }
    if (is_object($value) && method_exists($value, 'id')) {
      return (int) $value->id();
    }
    if (is_numeric($value)) {
      return (int) $value;
    }
    if (is_array($value) && isset($value['target_id'])) {
      return (int) $value['target_id'];
    }
    return NULL;
  }

}
