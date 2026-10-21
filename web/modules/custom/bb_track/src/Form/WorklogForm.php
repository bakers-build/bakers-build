<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\bb_track\WorkAssignments;
use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityConstraintViolationListInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\Component\Uuid\Uuid;
use Drupal\Component\Uuid\UuidInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkTargetOptions;
use Drupal\island\Form\WrappedDialogFormTrait;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Native add/edit form for one owner's recorded Worklog.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 * @SuppressWarnings("PHPMD.CouplingBetweenObjects")
 */
final class WorklogForm extends FormBase {

  use WrappedDialogFormTrait;

  /**
   * Project and ticket candidates.
   */
  protected WorkTargetOptions $targets;

  /**
   * Constructs the form.
   *
   * Injected services are protected and not readonly: a POST caches this form,
   * and DependencySerializationTrait restores only those properties.
   *
   * @param \Drupal\Core\Session\AccountProxyInterface $currentUserProxy
   *   The current user.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface $readScope
   *   Workspace read scope for assignment checks.
   * @param \Drupal\bb_track\WorkAssignments $assignments
   *   Project billing-account assignments.
   * @param \Drupal\Component\Uuid\UuidInterface $uuidGenerator
   *   The UUID generator.
   */
  public function __construct(
    protected AccountProxyInterface $currentUserProxy,
    protected EntityTypeManagerInterface $entityTypeManager,
    protected BbWorkspaceReadScopeInterface $readScope,
    protected WorkAssignments $assignments,
    protected UuidInterface $uuidGenerator,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = new static(
      $container->get('current_user'),
      $container->get('entity_type.manager'),
      $container->get('bb_core.workspace_read_scope'),
      $container->get('bb_track.assignments'),
      $container->get('uuid'),
    );
    $form->islandResponder = $container->get('island.responder');
    $form->targets = $container->get('bb_track.target_options');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_worklog_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(
    array $form,
    FormStateInterface $form_state,
    ?Worklog $bb_track_worklog = NULL,
  ): array {
    $entry = $bb_track_worklog;
    $account = $this->currentUserProxy;
    $read_only = FALSE;
    if ($entry instanceof Worklog) {
      $update_access = $entry->access('update', $account, TRUE);
      CacheableMetadata::createFromObject($update_access)->applyTo($form);
      $read_only = !$update_access->isAllowed();
    }
    // A full document POST, never a boosted fragment: Save redirects to the
    // permalink, and a boosted submit would swap the add form empty.
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#attributes']['autocomplete'] = 'off';
    $form['messages'] = [
      '#type' => 'status_messages',
      '#weight' => -1000,
    ];
    $form_state->set('entry', $entry);

    $layout = new WorklogFormLayout($this->defaultWorkDate($account), $this->targets);
    $defaults = $entry instanceof Worklog
      ? $layout->attachExisting($form, $form_state, $entry, $account)
      : $this->prefill($form, $form_state, WorklogFormLayout::emptyDefaults(), $account);
    $form = $layout->build(
      $form,
      $form_state,
      $entry,
      $account,
      $read_only,
      $defaults,
      WorklogOverviewDestination::fromRequest($this->getRequest()),
    );
    // Inside the ticket wrapper, so the same ajax refresh re-resolves it.
    if (is_array($form_state->get('selected_target'))) {
      [$project_id, $ticket_id] = $form_state->get('selected_target');
      $form['ticket_wrapper'] += $this->accountChoice()->element($form_state, $form_state->getUserInput(), 'account_target', $project_id, $ticket_id, $entry, ['account']);
      $form['ticket_wrapper']['account']['#disabled'] = $read_only;
    }
    if (!$entry instanceof Worklog && $form_state->get('default_work_date')) {
      $form['work_date']['#default_value'] = $form_state->get('default_work_date');
    }
    if (isset($form['actions']['submit'])) {
      // A second click while the request runs cannot post the form again.
      $form['actions']['submit']['#attributes']['data-hx-disabled-elt'] = 'this';
    }
    $this->attachTicketRefresh($form);
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * Refreshes the ticket field through htmx when a picker clicks its button.
   *
   * Posts to the url the form itself posts to, so a dialog keeps its wrapper
   * format and its wiring through the rebuild; no `onlyMainContent()`, which
   * would replace that format. Core reads the button from `HX-Trigger-Name`.
   *
   * @param array<string, mixed> $form
   *   The built form.
   */
  private function attachTicketRefresh(array &$form): void {
    if (!isset($form['ticket_wrapper']['fallback']['search_tickets'])) {
      return;
    }
    $url = $this->isDialogRequest()
      ? $this->dialogPostUrl()
      : Url::fromRoute('<current>', [], ['query' => $this->getRequest()->query->all()]);
    (new Htmx())
      ->post($url)
      ->target('#bakers-track-ticket')
      ->select('#bakers-track-ticket')
      ->swap('outerHTML')
      ->applyTo($form['ticket_wrapper']['fallback']['search_tickets']);
  }

  /**
   * Applies permitted caller context to a new entry.
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool} $defaults
   *   Empty defaults.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   Acting account.
   *
   * @return array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool}
   *   Defaults with the permitted project and ticket.
   */
  private function prefill(array &$form, FormStateInterface $form_state, array $defaults, AccountInterface $account): array {
    $entry_uuid = $form_state->get('entry_uuid') ?? $this->uuidGenerator->generate();
    $form_state->set('entry_uuid', $entry_uuid);
    $form['entry_uuid'] = ['#type' => 'hidden', '#default_value' => $entry_uuid];
    $context = $this->validator()->prefill($this->getRequest()->query->all(), $account);
    if (!$form_state->has('prefill_notices')) {
      $form_state->set('prefill_notices', TRUE);
      foreach ($context['notices'] as $notice) {
        $this->messenger()->addWarning($notice);
      }
    }
    $form_state->set('submission_id', $context['submission']?->id());
    $form_state->set('default_work_date', $context['date']);
    return ['project' => $context['project'], 'ticket' => $context['ticket']] + $defaults;
  }

  /**
   * Rebuilds the form so the ticket field follows project and search text.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function rebuildTickets(array &$form, FormStateInterface $form_state): void {
    $form_state->setRebuild();
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $entry = $form_state->get('entry');
    $account = $this->currentUserProxy;
    $existing = $entry instanceof Worklog ? $entry : NULL;
    if ($existing instanceof Worklog && !$existing->access('update', $account)) {
      $form_state->setErrorByName('', $this->t('You cannot change this entry.'));
      return;
    }
    $this->validator()->validate($form_state, $existing, $account);
    $this->validateAccount($form, $form_state, $existing);
    if (!$existing instanceof Worklog && $this->replayedEntry($form_state, $account) === NULL) {
      $form_state->setErrorByName('', $this->t('The time entry could not be saved. Try again.'));
    }
    if ($existing instanceof Worklog) {
      $fresh = $this->reload($existing);
      $expected = (string) $form_state->getValue('expected_version');
      if ($fresh === NULL || $expected === '' || $fresh->version() !== $expected) {
        $form_state->setErrorByName('', $this->t('This entry changed. Reload it before saving.'));
      }
    }
    $this->focusFirstError($form, $form_state);
  }

  /**
   * Checks the chosen account, or resolves one, for the validated target.
   *
   * The resolver's message lands on the project when there was nothing to
   * choose from, on the account otherwise.
   */
  private function validateAccount(array $form, FormStateInterface $form_state, ?Worklog $existing): void {
    if ($form_state->getErrors()) {
      return;
    }
    $ticket = $form_state->get('ticket_id') ? (int) $form_state->get('ticket_id') : NULL;
    try {
      $form_state->set('account_id', $this->accountChoice()->accountId((int) $form_state->get('project_id'), $ticket, $form_state->getValue('account'), $existing));
    }
    catch (\DomainException $error) {
      $form_state->setErrorByName(isset($form['ticket_wrapper']['account']['#picker_options']) ? 'account' : 'project', $error->getMessage());
    }
  }

  /**
   * The billing-account choice from restored services.
   */
  private function accountChoice(): AccountChoice {
    return new AccountChoice($this->assignments);
  }

  /**
   * Moves focus to the first field with an error.
   */
  private function focusFirstError(array &$form, FormStateInterface $form_state): void {
    $parents = [
      'work_date' => ['work_date'],
      'duration' => ['duration'],
      'project' => ['project'],
      'ticket' => ['ticket_wrapper', 'ticket'],
      'account' => ['ticket_wrapper', 'account'],
      'description' => ['description'],
    ];
    foreach ($parents as $name => $path) {
      if (isset($form_state->getErrors()[$name])) {
        $element = &NestedArray::getValue($form, $path);
        $element['#attributes']['autofocus'] = 'autofocus';
        return;
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $entry = $form_state->get('entry');
    $existing = $entry instanceof Worklog ? $entry : NULL;
    $saved = $this->saveSubmitted($form_state, $existing);
    if (!$saved instanceof Worklog) {
      return;
    }
    $this->messenger()->addStatus($this->t('Time entry saved.'));
    if ($this->isDialogRequest()) {
      $this->respondAtReturnUrl($form_state);
      return;
    }
    $form_state->setRedirect('bb_track.worklog.edit', [
      'bb_track_worklog' => $saved->uuid(),
    ]);
  }

  /**
   * Saves the submitted entry, or rebuilds the form with an error.
   */
  private function saveSubmitted(
    FormStateInterface $form_state,
    ?Worklog $existing,
  ): ?Worklog {
    $account = $this->currentUserProxy;
    try {
      $replayed = !$existing instanceof Worklog ? $this->replayedEntry($form_state, $account) : FALSE;
      if ($replayed !== FALSE) {
        return $replayed;
      }
      $entry = $this->entryToSave($existing, $form_state, $account);
      if (!$entry instanceof Worklog || !$this->populateAndValidate($entry, $form_state, $existing)) {
        return NULL;
      }
      $entry->save();
      return $entry;
    }
    catch (\Throwable $throwable) {
      $this->logger('bb_track')->error('Worklog save failed: @message', [
        '@message' => $throwable->getMessage(),
      ]);
      $this->messenger()->addError($throwable instanceof \DomainException
        ? $throwable->getMessage()
        : $this->t('The time entry could not be saved. Try again.'));
      $form_state->setRebuild();
      return NULL;
    }
  }

  /**
   * Fills, resolves and validates the entry; FALSE rebuilds with an error.
   */
  private function populateAndValidate(Worklog $entry, FormStateInterface $form_state, ?Worklog $existing): bool {
    $entry->expectedVersion = $existing ? (string) $form_state->getValue('expected_version') : NULL;
    $project = (int) $form_state->get('project_id');
    $ticket = $form_state->get('ticket_id') ? (int) $form_state->get('ticket_id') : NULL;
    // Checked or resolved in validateAccount(); the storage guard re-checks.
    $entry->set('account_id', $form_state->get('account_id'));
    $entry->set('work_date', (string) $form_state->getValue('work_date'));
    $entry->set('duration_seconds', (int) $form_state->get('duration_seconds'));
    $entry->set('description', (string) $form_state->get('trimmed_description'));
    $entry->set('project_id', $project);
    $entry->set('ticket_id', $ticket);
    $entry->set('derivation', 'manual');
    $violations = $entry->validate();
    if ($violations instanceof EntityConstraintViolationListInterface) {
      $violations->filterByFields([
        'owner_user_id',
        'project_id',
        'ticket_id',
      ]);
    }
    if ($violations->count() === 0) {
      return TRUE;
    }
    foreach ($violations as $violation) {
      $this->messenger()->addError((string) $violation->getMessage());
    }
    $form_state->setRebuild();
    return FALSE;
  }

  /**
   * Reloads an existing row or creates a stamped new one.
   */
  private function entryToSave(
    ?Worklog $existing,
    FormStateInterface $form_state,
    AccountInterface $account,
  ): ?Worklog {
    if (!$existing instanceof Worklog) {
      $submission = $form_state->get('submission_id') ? Submission::load($form_state->get('submission_id')) : NULL;
      return Worklog::create([
        'uuid' => $this->entryUuid($form_state),
        'owner_user_id' => $account->id(),
        'derivation' => 'manual',
        'state' => $submission?->get('state')->value === 'proposed' ? 'proposed' : 'recorded',
        'submission_id' => $submission?->id(),
        'timezone' => $this->snapshotTimezone($account),
      ]);
    }
    $fresh = $this->reload($existing);
    if (!$fresh instanceof Worklog) {
      $this->messenger()->addError($this->t('This entry changed. Reload it before saving.'));
      $form_state->setRebuild();
      return NULL;
    }
    if (!$fresh->access('update', $account)) {
      $this->messenger()->addError($this->t('You cannot change this entry.'));
      $form_state->setRebuild();
      return NULL;
    }
    return $fresh;
  }

  /**
   * The add form's own entry UUID, which makes a replayed POST harmless.
   */
  private function entryUuid(FormStateInterface $form_state): ?string {
    $uuid = (string) ($form_state->getValue('entry_uuid') ?? $form_state->get('entry_uuid') ?? '');
    return Uuid::isValid($uuid) ? $uuid : NULL;
  }

  /**
   * The entry an earlier POST of this add form already stored.
   *
   * @return \Drupal\bb_track\Entity\Worklog|false|null
   *   The own stored entry, NULL for an unavailable one, or FALSE when this
   *   form has not been saved yet.
   */
  private function replayedEntry(FormStateInterface $form_state, AccountInterface $account): Worklog|false|null {
    $uuid = $this->entryUuid($form_state);
    if ($uuid === NULL) {
      return FALSE;
    }
    $found = $this->entityTypeManager->getStorage('bb_track_worklog')->loadByProperties(['uuid' => $uuid]);
    $stored = reset($found);
    if (!$stored instanceof Worklog) {
      return FALSE;
    }
    return (int) $stored->getOwnerId() === (int) $account->id() && !$stored->get('voided')->value ? $stored : NULL;
  }

  /**
   * Default work date in the owner, site or UTC timezone.
   */
  private function defaultWorkDate(AccountProxyInterface $account): string {
    return (new \DateTimeImmutable('now', $this->timezone($account)))->format('Y-m-d');
  }

  /**
   * Snapshots the actor timezone, then site, then UTC.
   */
  private function snapshotTimezone(AccountInterface $account): string {
    return $this->timezone($account)->getName();
  }

  /**
   * Resolves the actor, site or UTC timezone.
   */
  private function timezone(AccountInterface $account): \DateTimeZone {
    $user = $account instanceof UserInterface
      ? $account
      : $this->entityTypeManager->getStorage('user')->load($account->id());
    $name = '';
    if ($user instanceof UserInterface) {
      $name = (string) $user->getTimeZone();
    }
    if ($name === '') {
      $name = (string) ($this->config('system.date')->get('timezone.default') ?? '');
    }
    try {
      return new \DateTimeZone($name !== '' ? $name : 'UTC');
    }
    catch (\Exception) {
      return new \DateTimeZone('UTC');
    }
  }

  /**
   * Field and assignment validator from restored services.
   */
  private function validator(): WorklogFormValidator {
    return new WorklogFormValidator($this->entityTypeManager, $this->readScope);
  }

  /**
   * Reloads a worklog row from storage.
   */
  private function reload(Worklog $entry): ?Worklog {
    $storage = $this->entityTypeManager->getStorage('bb_track_worklog');
    $storage->resetCache([
      $entry->id(),
    ]);
    $fresh = $storage->load($entry->id());
    return $fresh instanceof Worklog ? $fresh : NULL;
  }

}
