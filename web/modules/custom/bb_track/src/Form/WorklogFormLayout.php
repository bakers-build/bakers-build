<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Component\Utility\Html;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Element\Date;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Element\PickerValue;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Form\OverlayTrigger;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkTargetOptions;
use Drupal\bb_track\WorkTimeRules;

/**
 * Builds native add/edit elements for one Worklog row.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class WorklogFormLayout implements TrustedCallbackInterface {

  use StringTranslationTrait;

  /**
   * Picker value that keeps an unresolved ticket.
   */
  public const string RETAINED = 'retained';

  /**
   * Constructs the layout helper.
   */
  public function __construct(
    private readonly string $defaultWorkDate,
    private readonly ?WorkTargetOptions $targets = NULL,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['renderPicker'];
  }

  /**
   * A single-choice picker element: Form API value, property pill look.
   *
   * @param string $label
   *   Field name on the pill.
   * @param string $icon
   *   Leading icon.
   * @param array<int|string, string> $options
   *   Labels keyed by value; numeric string keys are ints in PHP arrays.
   * @param list<string> $default
   *   The value it opens on, or an empty list.
   * @param string $clear_label
   *   Label of the clear row; empty for none.
   *
   * @return array<string, mixed>
   *   The element.
   */
  public static function picker(string $label, string $icon, array $options, array $default, string $clear_label = ''): array {
    return [
      '#type' => 'bb_picker_value',
      '#title' => $label,
      '#title_display' => 'invisible',
      '#default_value' => $default,
      '#picker_label' => $label,
      '#picker_icon' => $icon,
      '#picker_options' => array_map(static fn (string $option): array => ['label' => $option], $options),
      '#picker_clear_label' => $clear_label,
      // Like core form elements, a picker can sit in a details group.
      '#process' => [[PickerValue::class, 'processGroup']],
      '#pre_render' => [[PickerValue::class, 'preRenderGroup'], [self::class, 'renderPicker']],
    ];
  }

  /**
   * Renders the pill from the processed value, so a refused submit keeps it.
   *
   * @param array<string, mixed> $element
   *   The processed picker element.
   *
   * @return array<string, mixed>
   *   The element with its `control` child.
   */
  public static function renderPicker(array $element): array {
    $value = (string) (($element['#value'] ?? [])[0] ?? '');
    $options = $element['#picker_options'];
    $rows = [];
    foreach ($options as $key => $option) {
      $rows[] = ['value' => (string) $key, 'label' => $option['label'], 'selected' => (string) $key === $value];
    }
    $clear_label = $element['#picker_clear_label'];
    $props = [
      'name' => $element['#name'],
      'label' => $element['#picker_label'],
      'icon' => $element['#picker_icon'],
      'picker_id' => $element['#id'],
      'multiple' => FALSE,
      'open' => FALSE,
      'searchable' => TRUE,
      // AJAX insertion parses noscript contents into live controls.
      'fallback' => !\Drupal::request()->isXmlHttpRequest(),
      'values' => isset($options[$value]) ? [$value] : [],
      'clearable' => $clear_label !== '',
      'clear_label' => $clear_label,
      'options' => $rows,
    ];
    if (isset($options[$value])) {
      $props['value_label'] = $options[$value]['label'];
    }
    if (!empty($element['#picker_search_url'])) {
      $props['search_url'] = $element['#picker_search_url'];
    }
    if (!empty($element['#picker_attributes'])) {
      $props['attributes'] = new Attribute($element['#picker_attributes']);
    }
    $element['control'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:property_pill',
      '#props' => $props,
    ];
    return $element;
  }

  /**
   * Assembles the form elements for add or edit.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param \Drupal\bb_track\Entity\Worklog|null $entry
   *   Existing row, or NULL on add.
   * @param \Drupal\Core\Session\AccountProxyInterface $account
   *   Acting account.
   * @param bool $read_only
   *   TRUE when the row cannot be updated.
   * @param array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool} $defaults
   *   Visible project/ticket defaults and unresolved flags.
   * @param string|null $destination
   *   Validated local overview destination, or NULL.
   *
   * @return array<string, mixed>
   *   The populated form.
   */
  public function build(
    array $form,
    FormStateInterface $form_state,
    ?Worklog $entry,
    AccountProxyInterface $account,
    bool $read_only,
    array $defaults,
    ?string $destination = NULL,
  ): array {
    $this->addScalars($form, $entry, $read_only);
    $this->addProject($form, $form_state, $defaults, $read_only);
    $this->addTicket($form, $form_state, $defaults, $read_only);
    $this->addDescription($form, $entry, $read_only);
    $this->addActions($form, $entry, $account, $read_only, $destination);
    // Record time asks in the reader's order: what for, when, how long, what.
    foreach (['project' => -30, 'ticket_wrapper' => -29, 'work_date' => -20, 'duration' => -19, 'description' => -10] as $name => $weight) {
      $form[$name]['#weight'] = $weight;
    }
    if ($entry instanceof Worklog) {
      $this->addContext($form, $entry, $defaults, $account);
    }
    return $form;
  }

  /**
   * Leads an existing row with its fixed context; targets sit behind Change.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\bb_track\Entity\Worklog $entry
   *   Existing row.
   * @param array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool} $defaults
   *   Visible defaults and unresolved flags.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   Acting account.
   */
  private function addContext(array &$form, Worklog $entry, array $defaults, AccountInterface $account): void {
    $project = $defaults['project'];
    $summary = (new \DateTimeImmutable((string) $entry->get('work_date')->value))->format('D d M')
      . ' · ' . $this->customerLabel($project, $account)
      . ' · ' . ($project instanceof BbProjectInterface ? (string) $project->label() : (string) $this->t('Unresolved project'));
    if ($defaults['ticket'] instanceof ContentEntityInterface) {
      $summary .= ' / ' . $defaults['ticket']->label();
    }
    elseif ($defaults['ticket_unresolved']) {
      $summary .= ' / ' . $this->t('Unresolved ticket');
    }
    $state = (string) $entry->get('state')->value;
    $form['context'] = [
      '#type' => 'container',
      '#weight' => -50,
      'summary' => [
        '#type' => 'component',
        '#component' => 'bb_theme:text',
        // ui_patterns marks string props safe, so names are escaped here.
        '#props' => ['text' => Html::escape($summary), 'as' => 'p', 'size' => 'body'],
      ],
      'state' => [
        '#type' => 'component',
        '#component' => 'bb_theme:badge',
        '#props' => [
          'label' => (string) match ($state) {
            'proposed' => $this->t('Proposed'),
            'approved' => $this->t('Approved'),
            default => $this->t('Recorded'),
          },
          'tone' => $state === 'proposed' ? 'attention' : 'neutral',
        ],
      ],
    ];
    $form['change'] = [
      '#type' => 'details',
      '#title' => $this->t('Change date, project or ticket'),
      '#open' => FALSE,
      '#weight' => -40,
      '#theme_wrappers' => ['details__worklog_change'],
    ];
    foreach (['work_date', 'project', 'ticket_wrapper'] as $name) {
      $form[$name]['#group'] = 'change';
    }
    // Core's date element omits the group callbacks other inputs carry.
    $form['work_date']['#process'] = [[Date::class, 'processAjaxForm'], [Date::class, 'processGroup']];
    $form['work_date']['#pre_render'] = [[Date::class, 'preRenderDate'], [Date::class, 'preRenderGroup']];
  }

  /**
   * Attaches version and retained ids for an existing row.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param \Drupal\bb_track\Entity\Worklog $entry
   *   Existing row.
   * @param \Drupal\Core\Session\AccountProxyInterface $account
   *   Acting account.
   *
   * @return array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool}
   *   Visible defaults and unresolved flags.
   */
  public function attachExisting(
    array &$form,
    FormStateInterface $form_state,
    Worklog $entry,
    AccountProxyInterface $account,
  ): array {
    $project_item = $entry->get('project_id');
    $ticket_item = $entry->get('ticket_id');
    $project = $this->visibleEntity($project_item->entity, $account);
    $ticket = $this->visibleEntity($ticket_item->entity, $account);
    $project_unresolved = $project === NULL;
    $ticket_unresolved = !$ticket_item->isEmpty() && $ticket === NULL;
    $form['expected_version'] = [
      '#type' => 'hidden',
      '#default_value' => $entry->version(),
    ];
    if ($ticket_unresolved && !$form_state->has('retained_ticket_id')) {
      $form_state->set('retained_ticket_id', (int) $ticket_item->target_id);
    }
    if ($project_unresolved && !$form_state->has('retained_project_id')) {
      $form_state->set('retained_project_id', (int) $project_item->target_id);
    }
    return [
      'project' => $project,
      'ticket' => $ticket,
      'project_unresolved' => $project_unresolved,
      'ticket_unresolved' => $ticket_unresolved,
    ];
  }

  /**
   * Empty defaults for a new row.
   *
   * @return array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool}
   *   No selected targets.
   */
  public static function emptyDefaults(): array {
    return [
      'project' => NULL,
      'ticket' => NULL,
      'project_unresolved' => FALSE,
      'ticket_unresolved' => FALSE,
    ];
  }

  /**
   * Reads a numeric project id from a picker or autocomplete value.
   */
  public static function selectedProjectId(mixed $selected_project): ?int {
    if (is_array($selected_project) && array_is_list($selected_project)) {
      $selected_project = $selected_project[0] ?? NULL;
    }
    if (is_numeric($selected_project)) {
      return (int) $selected_project;
    }
    if (is_object($selected_project) && method_exists($selected_project, 'id')) {
      return (int) $selected_project->id();
    }
    if (is_array($selected_project) && isset($selected_project['target_id'])) {
      return (int) $selected_project['target_id'];
    }
    if (is_string($selected_project) && preg_match('/\((\d+)\)\s*$/', $selected_project, $matches)) {
      return (int) $matches[1];
    }
    return NULL;
  }

  /**
   * Formats stored seconds as H:MM.
   */
  public static function formatDuration(int $seconds): string {
    $hours = intdiv($seconds, 3600);
    $minutes = intdiv($seconds % 3600, 60);
    return sprintf('%d:%02d', $hours, $minutes);
  }

  /**
   * Parses H:MM into a positive minute-precision second count.
   */
  public static function parseDuration(mixed $raw): ?int {
    if (!is_string($raw) && !is_int($raw)) {
      return NULL;
    }
    $value = trim((string) $raw);
    if (!preg_match(WorkTimeRules::DURATION_PATTERN, $value, $matches)) {
      return NULL;
    }
    $seconds = ((int) $matches[1]) * 3600 + ((int) $matches[2]) * 60;
    try {
      WorkTimeRules::seconds($seconds);
    }
    catch (\InvalidArgumentException) {
      return NULL;
    }
    return $seconds;
  }

  /**
   * Adds date and duration.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\bb_track\Entity\Worklog|null $entry
   *   Existing row, or NULL on add.
   * @param bool $read_only
   *   TRUE when the row cannot be updated.
   */
  private function addScalars(array &$form, ?Worklog $entry, bool $read_only): void {
    $form['work_date'] = [
      '#type' => 'date',
      '#title' => $this->t('Date'),
      '#required' => TRUE,
      '#default_value' => $entry?->get('work_date')->value ?? $this->defaultWorkDate,
      '#disabled' => $read_only,
    ];
    $form['duration'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Duration (hours:minutes)'),
      '#description' => $this->t('Hours and minutes as H:MM. Examples: 0:30, 1:15.'),
      '#required' => TRUE,
      '#default_value' => $entry instanceof Worklog
        ? self::formatDuration((int) $entry->get('duration_seconds')->value)
        : '',
      '#disabled' => $read_only,
      '#size' => 8,
      '#attributes' => ['autocomplete' => 'off'],
    ];
  }

  /**
   * Adds the project picker.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool} $defaults
   *   Visible defaults and unresolved flags.
   * @param bool $read_only
   *   TRUE when the row cannot be updated.
   */
  private function addProject(
    array &$form,
    FormStateInterface $form_state,
    array $defaults,
    bool $read_only,
  ): void {
    $project_default = $defaults['project'];
    $options = $this->targets?->projects() ?? [];
    $default = [];
    if ($project_default instanceof BbProjectInterface) {
      $default = [(string) $project_default->id()];
      $options += [(string) $project_default->id() => $this->targets?->projectLabel($project_default) ?? (string) $project_default->label()];
    }
    $form['project'] = self::picker((string) $this->t('Project'), 'project', $options, $default) + [
      '#disabled' => $read_only,
      // A pick re-renders the ticket field for the new project.
      '#picker_attributes' => [
        // The panel's search box bubbles its own change; a pick may come from
        // an inner element, so filter on the source instead of `.self`.
        'x-on:change' => "\$event.target.type !== 'search' && \$el.closest('form')?.querySelector('[data-bakers-ticket-search]')?.click()",
      ],
    ];
    if ($defaults['project_unresolved']) {
      $form['project_unresolved'] = [
        '#type' => 'item',
        '#markup' => $this->t('Unresolved project. Select a replacement to change it.'),
      ];
    }
    $form_state->set('bb_project_default', $project_default);
  }

  /**
   * The currently selected project id, from value, input or project default.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param array<string, mixed> $input
   *   Raw user input.
   */
  private function selectedProjectFromState(FormStateInterface $form_state, array $input): ?int {
    $default_project = $form_state->get('bb_project_default');
    return self::selectedProjectId(
      $form_state->getValue('project')
        ?? ($input['project'] ?? NULL)
        ?? ($default_project instanceof BbProjectInterface ? $default_project->id() : NULL),
    );
  }

  /**
   * The submitted ticket ids, or the visible default when none were posted.
   *
   * @param array<string, mixed> $input
   *   Raw user input.
   * @param array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool} $defaults
   *   Visible defaults and unresolved flags.
   *
   * @return list<string>
   *   Selected ticket ids.
   */
  private function submittedTicketIds(array $input, array $defaults): array {
    if (!array_key_exists('ticket', $input)) {
      return $defaults['ticket'] instanceof ContentEntityInterface ? [(string) $defaults['ticket']->id()] : [];
    }
    return array_values(array_map(
      static fn (mixed $value): string => (string) $value,
      array_filter((array) $input['ticket'], 'is_scalar'),
    ));
  }

  /**
   * Adds the ticket picker scoped to the selected project.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool} $defaults
   *   Visible defaults and unresolved flags.
   * @param bool $read_only
   *   TRUE when the row cannot be updated.
   */
  private function addTicket(
    array &$form,
    FormStateInterface $form_state,
    array $defaults,
    bool $read_only,
  ): void {
    $input = $form_state->getUserInput();
    $selected_id = $this->selectedProjectFromState($form_state, $input);
    $ticket_ids = $this->submittedTicketIds($input, $defaults);
    $match = trim((string) ($input['ticket_search'] ?? ''));
    $options = $selected_id ? ($this->targets?->tickets($selected_id, $match === '' ? NULL : $match) ?? []) : [];
    $ticket_id = (int) ($ticket_ids[0] ?? 0);
    $form['ticket_wrapper'] = [
      '#type' => 'container',
      '#attributes' => ['id' => 'bakers-track-ticket'],
    ];
    [$options, $ticket_ids] = $this->resolveTicketOptions($form, $form_state, $input, $ticket_id, $selected_id, $options, $ticket_ids);
    if ($defaults['ticket_unresolved']) {
      // Kept until the reader picks No ticket or a replacement.
      $options = [self::RETAINED => (string) $this->t('Unresolved ticket')] + $options;
      $ticket_ids = $ticket_ids === [] && !array_key_exists('ticket', $input) ? [self::RETAINED] : $ticket_ids;
    }
    $form['ticket_wrapper']['ticket'] = self::picker((string) $this->t('Ticket'), 'ticket', $options, $ticket_ids === [] ? [] : [(string) $ticket_ids[0]], (string) $this->t('No ticket')) + [
      '#disabled' => $read_only,
      '#picker_search_url' => $selected_id
        ? Url::fromRoute('bb_track.worklog.ticket_options', [], ['query' => ['project' => $selected_id]])->toString()
        : '',
      // A pick re-resolves the billing account for the new ticket.
      '#picker_attributes' => [
        // The panel's search box bubbles its own change; a pick may come from
        // an inner element, so filter on the source instead of `.self`.
        'x-on:change' => "\$event.target.type !== 'search' && \$el.closest('form')?.querySelector('[data-bakers-ticket-search]')?.click()",
      ],
    ];
    $this->rememberTarget($form_state, $defaults, $selected_id, $ticket_ids);
    // Without JavaScript the typed text is searched by rebuilding the form;
    // with it the picker searches itself and core's js-hide hides this.
    $form['ticket_wrapper']['fallback'] = [
      '#type' => 'container',
      '#attributes' => ['class' => ['js-hide']],
    ];
    $form['ticket_wrapper']['fallback']['ticket_search'] = [
      '#type' => 'search',
      '#title' => $this->t('Find a ticket'),
      '#default_value' => $match,
      '#disabled' => $read_only,
      '#size' => 20,
    ];
    $form['ticket_wrapper']['fallback']['search_tickets'] = [
      '#type' => 'submit',
      '#value' => $this->t('Search tickets'),
      '#name' => 'search_tickets',
      '#submit' => ['::rebuildTickets'],
      '#limit_validation_errors' => [],
      '#disabled' => $read_only,
      // WorklogForm wires it to htmx; see WorklogForm::attachTicketRefresh().
      '#attributes' => ['data-bakers-ticket-search' => 'data-bakers-ticket-search'],
    ];
    if ($defaults['ticket_unresolved']) {
      $form['ticket_wrapper']['ticket_unresolved'] = [
        '#type' => 'item',
        '#markup' => $this->t('Unresolved ticket. Select a replacement, or No ticket to remove it.'),
      ];
    }
  }

  /**
   * Remembers the selected target; the form adds the billing account for it.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param array{project: mixed, ticket: mixed, project_unresolved: bool, ticket_unresolved: bool} $defaults
   *   Visible defaults and unresolved flags.
   * @param int|null $selected_id
   *   The selected project id, or NULL.
   * @param list<string> $ticket_ids
   *   Selected ticket ids.
   */
  private function rememberTarget(FormStateInterface $form_state, array $defaults, ?int $selected_id, array $ticket_ids): void {
    if ($defaults['project_unresolved'] || $selected_id === NULL) {
      $form_state->set('selected_target', NULL);
      return;
    }
    $first = (string) ($ticket_ids[0] ?? '');
    $ticket_id = $first === self::RETAINED ? $form_state->get('retained_ticket_id') : (ctype_digit($first) ? (int) $first : NULL);
    $form_state->set('selected_target', [$selected_id, $ticket_id]);
  }

  /**
   * Resolves ticket options, clearing a stale ticket id on rebuild.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param array<string, mixed> $input
   *   Raw user input.
   * @param int $ticket_id
   *   The currently selected ticket id, or 0 for none.
   * @param int|null $selected_id
   *   The currently selected project id, or NULL.
   * @param array<int|string, string> $options
   *   Ticket options so far.
   * @param list<string> $ticket_ids
   *   Currently selected ticket ids.
   *
   * @return array{0: array<int|string, string>, 1: list<string>}
   *   Updated options and ticket ids.
   */
  private function resolveTicketOptions(
    array &$form,
    FormStateInterface $form_state,
    array $input,
    int $ticket_id,
    ?int $selected_id,
    array $options,
    array $ticket_ids,
  ): array {
    if ($ticket_id <= 0 || $this->targets === NULL) {
      return [$options, $ticket_ids];
    }
    $label = $selected_id ? $this->targets->ticketOf($ticket_id, $selected_id) : NULL;
    if ($label !== NULL) {
      $options += [(string) $ticket_id => $label];
      return [$options, $ticket_ids];
    }
    // A rebuild for a new project clears the stale ticket and says so; a
    // posted save keeps it, so validation rejects it explicitly.
    if (!$form_state->isRebuilding()) {
      return [$options, $ticket_ids];
    }
    unset($input['ticket']);
    $form_state->setUserInput($input);
    $form_state->setValue('ticket', []);
    if ($selected_id) {
      $form['ticket_wrapper']['ticket_cleared'] = [
        '#type' => 'item',
        '#markup' => $this->t('Ticket cleared: it does not belong to @project.', [
          '@project' => $this->targets->projectName($selected_id),
        ]),
      ];
    }
    return [$options, []];
  }

  /**
   * Adds the description.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\bb_track\Entity\Worklog|null $entry
   *   Existing row, or NULL on add.
   * @param bool $read_only
   *   TRUE when the row cannot be updated.
   */
  private function addDescription(array &$form, ?Worklog $entry, bool $read_only): void {
    $form['description'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Description'),
      '#required' => TRUE,
      '#default_value' => $entry?->get('description')->value ?? '',
      '#disabled' => $read_only,
      '#maxlength' => 2000,
    ];
  }

  /**
   * Adds save, cancel, delete and record-another actions.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\bb_track\Entity\Worklog|null $entry
   *   Existing row, or NULL on add.
   * @param \Drupal\Core\Session\AccountProxyInterface $account
   *   Acting account.
   * @param bool $read_only
   *   TRUE when the row cannot be updated.
   * @param string|null $destination
   *   Validated local overview destination, or NULL.
   */
  private function addActions(
    array &$form,
    ?Worklog $entry,
    AccountProxyInterface $account,
    bool $read_only,
    ?string $destination,
  ): void {
    $form['actions'] = ['#type' => 'actions', '#weight' => 100];
    if (!$read_only) {
      $form['actions']['submit'] = [
        '#type' => 'submit',
        '#value' => $this->t('Save'),
      ];
    }
    $form['actions']['cancel'] = [
      '#type' => 'link',
      '#title' => $this->t('Cancel'),
      '#url' => $destination !== NULL
        ? Url::fromUserInput($destination)
        : Url::fromRoute('entity.user.canonical', [
          'user' => $account->id(),
        ]),
      // island.dialog.js closes X/Escape from this href. Create dialogs stamp
      // the same hook via BbCreateDialogFormBase::actions().
      '#attributes' => [
        'data-dialog-cancel' => 'data-dialog-cancel',
      ],
    ];
    if ($entry instanceof Worklog) {
      $this->addExistingActions($form, $entry, $account, $destination);
    }
    if ($this->isApprovedReadOnly($entry, $read_only)) {
      $form['approved'] = [
        '#type' => 'item',
        '#markup' => $this->t('Approved. This entry can no longer be changed.'),
      ];
    }
  }

  /**
   * Adds the separate Delete danger action for an existing row.
   *
   * @param array $form
   *   The form.
   * @param \Drupal\bb_track\Entity\Worklog $entry
   *   Existing row.
   * @param \Drupal\Core\Session\AccountProxyInterface $account
   *   Acting account.
   * @param string|null $destination
   *   Validated local overview destination, or NULL.
   */
  private function addExistingActions(
    array &$form,
    Worklog $entry,
    AccountProxyInterface $account,
    ?string $destination,
  ): void {
    $delete_access = $entry->access('delete', $account, TRUE);
    CacheableMetadata::createFromObject($delete_access)->applyTo($form);
    if ($delete_access->isAllowed()) {
      $form['delete'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#weight' => 110,
        '#attached' => ['library' => ['core/drupal.htmx']],
        '#props' => [
          'label' => (string) $this->t('Delete'),
          'href' => $this->deleteUrl($entry, $destination)->toString(),
          'variant' => 'danger',
          // The confirm dialog over this screen; href is the page without JS.
          'attributes' => new Attribute(OverlayTrigger::attributes($this->deleteUrl($entry, $destination))),
        ],
      ];
    }
  }

  /**
   * Delete confirm URL, carrying a validated overview destination.
   */
  private function deleteUrl(Worklog $entry, ?string $destination): Url {
    $query = [];
    if (is_string($destination) && $destination !== '') {
      $query['destination'] = $destination;
    }
    return Url::fromRoute('bb_track.worklog.delete', [
      'bb_track_worklog' => $entry->uuid(),
    ], [
      'query' => $query,
    ]);
  }

  /**
   * TRUE when the actor can only read an approved row.
   */
  private function isApprovedReadOnly(?Worklog $entry, bool $read_only): bool {
    return $read_only
      && $entry instanceof Worklog
      && (string) $entry->get('state')->value === 'approved';
  }

  /**
   * Customer name from the project's current group, or unresolved.
   */
  private function customerLabel(?ContentEntityInterface $project, AccountInterface $account): string {
    if (!$project instanceof BbProjectInterface) {
      return (string) $this->t('Unresolved customer');
    }
    $group = $project->getGroup();
    if (!$group instanceof BbGroupInterface || !$group->access('view', $account)) {
      return (string) $this->t('Unresolved customer');
    }
    return (string) $group->label();
  }

  /**
   * Returns the entity when the actor can view it.
   */
  private function visibleEntity(mixed $entity, AccountInterface $account): ?ContentEntityInterface {
    if (!$entity instanceof ContentEntityInterface || !$entity->access('view', $account)) {
      return NULL;
    }
    return $entity;
  }

}
