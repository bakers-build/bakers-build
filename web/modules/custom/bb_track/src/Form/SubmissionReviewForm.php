<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\Url;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Proposals;
use Drupal\bb_track\WorkAssignments;
use Drupal\bb_track\WorkTargetOptions;
use Drupal\bb_track\WorkTimeRules;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Reviews a complete submission in the shared editable timesheet table.
 *
 * @SuppressWarnings("PHPMD.UnusedFormalParameter")
 */
final class SubmissionReviewForm extends FormBase implements TrustedCallbackInterface {

  /**
   * The proposal operations.
   */
  protected Proposals $proposals;

  /**
   * Accessible assignment options.
   */
  protected WorkTargetOptions $targets;

  /**
   * Billing-account resolution.
   */
  protected WorkAssignments $assignments;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = new static();
    $form->proposals = $container->get('bb_track.proposals');
    $form->targets = $container->get('bb_track.target_options');
    $form->assignments = $container->get('bb_track.assignments');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_submission_review';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?Submission $bb_track_submission = NULL): array {
    assert($bb_track_submission instanceof Submission);
    $form_state->set('submission_id', $bb_track_submission->id());
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    $rows = $this->proposals->rows($bb_track_submission);
    // GET forms are not cached: carry the complete rendered snapshot on POST.
    $form['versions'] = [
      '#type' => 'hidden',
      '#default_value' => json_encode(array_map(static fn (Worklog $row): string => $row->version(), $rows), JSON_THROW_ON_ERROR),
    ];
    $open = $bb_track_submission->get('state')->value === 'proposed';
    $form['#cache']['max-age'] = 0;
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#attributes']['autocomplete'] = 'off';
    $status = [
      'proposed' => $this->t('Review these entries, then save the complete submission.'),
      'draft' => $this->t('Time recorded. You can correct individual entries below.'),
      'submitted' => $this->t('Submitted. Your entries remain available in My time.'),
      'discarded' => $this->t('Proposal discarded. No proposed entries remain.'),
    ];
    $form['state'] = [
      '#type' => 'item',
      '#markup' => $status[$bb_track_submission->get('state')->value],
    ];
    $form['days'] = [
      '#type' => 'container',
      '#attributes' => ['id' => 'submission-days'],
      '#pre_render' => [[self::class, 'renderSheet']],
      '#dates' => [],
      '#access' => $rows !== [],
      '#open' => $open,
    ];
    foreach ($rows as $id => $row) {
      $date = (string) $row->get('work_date')->value;
      $form['days']['#dates'][$id] = $date;
      $form['days']['entries'][$id] = $this->entry($row, $open, $form_state);
    }
    if ($rows === []) {
      $form['empty'] = ['#type' => 'item', '#markup' => $this->t('This submission has no entries.')];
    }
    if ($open) {
      $form['actions'] = ['#type' => 'actions', '#theme_wrappers' => ['container__form_actions']];
      $form['actions']['save'] = [
        '#type' => 'submit',
        '#value' => $this->t('Save time'),
        '#access' => $rows !== [],
        '#theme_wrappers' => ['input__submit__bb_button'],
        '#weight' => 10,
        '#bb_variant' => 'success',
      ];
      $form['actions']['refresh'] = [
        '#type' => 'submit',
        '#name' => 'refresh',
        '#value' => $this->t('Update ticket choices'),
        '#theme_wrappers' => ['input__submit__bb_button'],
        '#bb_variant' => 'neutral',
        '#submit' => ['::refresh'],
        '#limit_validation_errors' => [],
        '#attributes' => ['data-submission-refresh' => 'true', 'class' => ['js-hide']],
        '#ajax' => ['callback' => '::days', 'wrapper' => 'submission-days', 'event' => 'click'],
      ];
      $form['actions']['discard'] = [
        '#type' => 'submit',
        '#name' => 'discard',
        '#value' => $this->t('Discard proposal'),
        '#theme_wrappers' => ['input__submit__bb_button'],
        '#bb_variant' => 'danger',
        '#submit' => ['::discard'],
        '#limit_validation_errors' => [],
      ];
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['renderSheet'];
  }

  /**
   * Places processed form controls in the same table used by the week editor.
   */
  public static function renderSheet(array $element): array {
    $days = array_values(array_unique($element['#dates']));
    sort($days);
    $columns = [['key' => 'label', 'label' => (string) t('Project / activity'), 'row_header' => TRUE]];
    $totals = array_fill_keys($days, 0);
    foreach ($days as $date) {
      $columns[] = ['key' => $date, 'label' => (new \DateTimeImmutable($date))->format('D Y-m-d'), 'num' => TRUE];
    }
    $columns[] = ['key' => 'total', 'label' => (string) t('Total'), 'num' => TRUE];
    $rows = [];
    foreach ($element['#dates'] as $id => $date) {
      $entry = $element['entries'][$id];
      $duration = $entry['duration'];
      unset($entry['duration']);
      $seconds = WorklogFormLayout::parseDuration($duration['#value']) ?? 0;
      $totals[$date] += $seconds;
      $cell = $element['#open'] ? [
        'kind' => 'input',
        'name' => $duration['#name'],
        'value' => $duration['#value'],
        'label' => (string) t('Duration (hours:minutes)'),
        'stored' => $seconds,
        'error' => (string) ($duration['#errors'] ?? ''),
        'sums' => ['row:' . $id, 'day:' . $date, 'total'],
      ] : ['kind' => 'text', 'value' => $duration['#value']];
      $cells = [
        'label' => ['kind' => 'rendered', 'markup' => \Drupal::service('renderer')->render($entry)],
        $date => $cell,
        'total' => [
          'kind' => 'text',
          'value' => WorklogFormLayout::formatDuration($seconds),
          'sum' => 'row:' . $id,
          'seconds' => $seconds,
        ],
      ];
      $rows[] = ['cells' => $cells];
    }
    $total_cells = ['label' => ['kind' => 'text', 'value' => (string) t('Total'), 'emphasis' => 'strong']];
    foreach ($totals + ['total' => array_sum($totals)] as $date => $seconds) {
      $total_cells[$date] = [
        'kind' => 'text',
        'value' => WorklogFormLayout::formatDuration($seconds),
        'emphasis' => 'strong',
        'sum' => $date === 'total' ? 'total' : 'day:' . $date,
        'seconds' => $seconds,
      ];
    }
    $rows[] = ['cells' => $total_cells];
    unset($element['entries']);
    $element['sheet'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:table',
      '#props' => ['variant' => '', 'live_sums' => TRUE, 'columns' => $columns, 'rows' => $rows],
    ];
    return $element;
  }

  /**
   * Builds one editable activity using the existing project/ticket pickers.
   */
  private function entry(Worklog $row, bool $open, FormStateInterface $form_state): array {
    $id = (int) $row->id();
    [$project, $ticket, $tickets] = $this->ticketChoices($row, $form_state);
    $entry = [
      '#type' => 'details',
      '#open' => $form_state->isRebuilding(),
      '#attributes' => ['data-submission-entry' => $row->uuid(), 'class' => ['min-w-0']],
      '#title' => $this->t('@project · @description', [
        '@project' => ($this->targets->projects()[$project] ?? $this->t('Unresolved project')) . ($ticket ? ' · ' . ($tickets[$ticket] ?? $this->t('Unresolved ticket')) : ''),
        '@description' => $row->get('description')->value,
      ]),
      'duration' => [
        '#type' => 'textfield',
        '#title' => $this->t('Duration (hours:minutes)'),
        '#id' => 'entries-' . $id . '-duration',
        '#default_value' => WorklogFormLayout::formatDuration((int) $row->get('duration_seconds')->value),
        '#required' => TRUE,
        '#size' => 8,
      ],
      'description' => [
        '#type' => 'textarea',
        '#title' => $this->t('Description'),
        '#default_value' => $row->get('description')->value,
        '#required' => TRUE,
        '#maxlength' => 2000,
        '#rows' => 2,
      ],
      'project' => WorklogFormLayout::picker((string) $this->t('Project'), 'project', $this->targets->projects(), $project ? [(string) $project] : []) + [
        '#picker_attributes' => ['x-on:change' => "\$event.target.type !== 'search' && \$el.closest('form')?.querySelector('[data-submission-refresh]')?.click()"],
      ],
      'ticket' => WorklogFormLayout::picker((string) $this->t('Ticket'), 'ticket', $tickets, $ticket ? [(string) $ticket] : [], (string) $this->t('No ticket')) + [
        '#picker_search_url' => $project ? Url::fromRoute('bb_track.worklog.ticket_options', [], ['query' => ['project' => $project]])->toString() : '',
        '#picker_attributes' => ['x-on:change' => "\$event.target.type !== 'search' && \$el.closest('form')?.querySelector('[data-submission-refresh]')?.click()"],
      ],
    ];
    $entry += $this->accountChoice($row, $form_state, $project, $ticket);
    $entry['search'] = [
      '#type' => 'container',
      '#attributes' => ['class' => ['js-hide']],
      '#access' => $open,
      'ticket_search' => [
        '#type' => 'search',
        '#title' => $this->t('Find a ticket'),
        '#size' => 20,
        '#parents' => ['entries', $id, 'ticket_search'],
      ],
    ];
    foreach (['duration', 'description', 'project', 'ticket', 'account'] as $field) {
      $entry[$field]['#parents'] = ['entries', $id, $field];
      $entry[$field]['#disabled'] = !$open;
    }
    if (!$open) {
      $this->readOnlyEntry($entry, $row);
    }
    return $entry;
  }

  /**
   * Resolves ticket choices and clears a stale ticket after project changes.
   */
  private function ticketChoices(Worklog $row, FormStateInterface $form_state): array {
    $id = (int) $row->id();
    $input = $form_state->getUserInput();
    $project = WorklogFormLayout::selectedProjectId($input['entries'][$id]['project'] ?? $row->get('project_id')->target_id);
    $ticket = WorklogFormLayout::selectedProjectId($input['entries'][$id]['ticket'] ?? $row->get('ticket_id')->target_id);
    $search = $input['entries'][$id]['ticket_search'] ?? '';
    $search = is_string($search) ? trim($search) : '';
    $tickets = $project ? $this->targets->tickets($project, $search === '' ? NULL : $search) : [];
    if ($ticket && $project) {
      $label = $this->targets->ticketOf($ticket, $project);
      if ($label !== NULL) {
        $tickets[$ticket] = $label;
      }
      elseif ($form_state->isRebuilding()) {
        $ticket = NULL;
        $input['entries'][$id]['ticket'] = [];
        $form_state->setUserInput($input)->setValue(['entries', $id, 'ticket'], []);
      }
    }
    return [$project, $ticket, $tickets];
  }

  /**
   * The billing account of one entry, resolved first and changeable after.
   *
   * @return array{account: array<string, mixed>, account_missing: array<string, mixed>}
   *   The elements.
   */
  private function accountChoice(Worklog $row, FormStateInterface $form_state, ?int $project, ?int $ticket): array {
    if (!$project) {
      return ['account' => ['#type' => 'value', '#value' => []], 'account_missing' => []];
    }
    $input = $form_state->getUserInput()['entries'][(int) $row->id()] ?? [];
    $parents = ['entries', (int) $row->id(), 'account'];
    return (new AccountChoice($this->assignments))
      ->element($form_state, is_array($input) ? $input : [], 'account_target:' . $row->id(), $project, $ticket, $row, $parents);
  }

  /**
   * Shows closed assignment labels and the existing correction link.
   */
  private function readOnlyEntry(array &$entry, Worklog $row): void {
    foreach (['project', 'ticket', 'account'] as $field) {
      $target = $row->get($field . '_id')->entity;
      $entry[$field] = [
        '#type' => 'item',
        '#title' => match ($field) {
          'project' => $this->t('Project'),
          'ticket' => $this->t('Ticket'),
          default => $this->t('Billing account'),
        },
        '#plain_text' => $target && $target->access('view') ? (string) $target->label() : (string) $this->t('None or unavailable'),
      ];
    }
    unset($entry['account_missing']);
    if ($row->access('update')) {
      $entry['edit'] = [
        '#type' => 'link',
        '#title' => $this->t('Edit entry'),
        '#url' => Url::fromRoute('bb_track.worklog.edit', ['bb_track_worklog' => $row->uuid()], [
          'query' => ['destination' => $this->getRequest()->getPathInfo()],
        ]),
      ];
    }
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $raw = $form_state->getValue('versions');
    $versions = is_string($raw) ? json_decode($raw, TRUE) : NULL;
    if (!is_array($versions)) {
      $form_state->setErrorByName('versions', $this->t('Reload the submission before saving.'));
    }
    $form_state->set('versions', $versions ?? []);
    $changes = [];
    foreach ($form_state->getValue('entries', []) as $id => $values) {
      $seconds = WorklogFormLayout::parseDuration($values['duration']);
      if ($seconds === NULL) {
        $form_state->setErrorByName('entries][' . $id . '][duration', WorkTimeRules::durationError($values['duration']));
      }
      $changes[$id] = [
        'duration_seconds' => $seconds,
        'description' => $values['description'],
        'project_id' => WorklogFormLayout::selectedProjectId($values['project']) ?? 0,
        'ticket_id' => WorklogFormLayout::selectedProjectId($values['ticket']),
        'account_id' => WorklogFormLayout::selectedProjectId($values['account'] ?? NULL),
      ];
    }
    $form_state->set('changes', $changes);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $submission = Submission::load($form_state->get('submission_id'));
    assert($submission instanceof Submission);
    try {
      $count = $this->proposals->save($submission, $form_state->get('changes'), $form_state->get('versions'));
      $this->messenger()->addStatus($this->t('@count entries recorded.', ['@count' => $count]));
      $form_state->setRedirectUrl($submission->toUrl());
    }
    catch (\DomainException | \InvalidArgumentException | \RuntimeException $error) {
      $this->messenger()->addError($error->getMessage());
      $form_state->setRebuild();
    }
  }

  /**
   * Refreshes ticket choices without recording any time.
   */
  public function refresh(array &$form, FormStateInterface $form_state): void {
    $form_state->setRebuild();
  }

  /**
   * Returns the refreshed day groups.
   */
  public function days(array &$form, FormStateInterface $form_state): array {
    return $form['days'];
  }

  /**
   * Discards the complete proposal without validating edited inputs.
   */
  public function discard(array &$form, FormStateInterface $form_state): void {
    $submission = Submission::load($form_state->get('submission_id'));
    assert($submission instanceof Submission);
    try {
      $count = $this->proposals->discard($submission);
      $this->messenger()->addStatus($this->t('@count proposed entries discarded.', ['@count' => $count]));
      $form_state->setRedirectUrl($submission->toUrl());
    }
    catch (\DomainException | \RuntimeException $error) {
      $this->messenger()->addError($error->getMessage());
      $form_state->setRebuild();
    }
  }

}
