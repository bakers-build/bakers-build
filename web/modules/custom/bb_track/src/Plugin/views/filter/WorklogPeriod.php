<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\views\filter;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\WorklogCalendar;
use Drupal\bb_track\WorklogSelection;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\display\DisplayPluginBase;
use Drupal\views\Plugin\views\filter\FilterPluginBase;
use Drupal\views\Plugin\views\query\Sql;
use Drupal\views\ViewExecutable;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Context scope, day/week period and filters of the time calendar.
 *
 * The `context` option names the calendar (personal, workspace, team or
 * project); the route supplies its subject. The resolved WorklogSelection is
 * the one condition source for rows and totals.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
#[ViewsFilter('bb_worklog_period')]
final class WorklogPeriod extends FilterPluginBase {

  /**
   * {@inheritdoc}
   *
   * @var bool
   */
  // phpcs:ignore Drupal.NamingConventions.ValidVariableName.LowerCamelName
  public $no_operator = TRUE;

  /**
   * Memoised selection for this request.
   */
  private ?WorklogSelection $resolvedSelection = NULL;

  /**
   * Constructs the filter.
   */
  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    private readonly RequestStack $requestStack,
    private readonly AccountInterface $currentUser,
    private readonly WorklogCalendar $calendar,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('request_stack'),
      $container->get('current_user'),
      $container->get('bb_track.worklog_calendar'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function init(ViewExecutable $view, DisplayPluginBase $display, ?array &$options = NULL): void {
    parent::init($view, $display, $options);
    // The calendar's own address, so the exposed form never builds one from
    // missing path arguments.
    if (!$view->override_url instanceof Url && $this->requestStack->getCurrentRequest() !== NULL) {
      $view->override_url = $this->calendarUrl();
    }
  }

  /**
   * {@inheritdoc}
   */
  protected function defineOptions(): array {
    $options = parent::defineOptions();
    $options['context'] = ['default' => 'workspace'];
    return $options;
  }

  /**
   * {@inheritdoc}
   *
   * @param mixed $form
   *   Views options form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   */
  public function buildOptionsForm(&$form, FormStateInterface $form_state): void {
    parent::buildOptionsForm($form, $form_state);
    $form['context'] = [
      '#type' => 'select',
      '#title' => $this->t('Context'),
      '#options' => array_combine(WorklogSelection::CONTEXTS, WorklogSelection::CONTEXTS),
      '#default_value' => $this->options['context'],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function canExpose(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function adminSummary(): string {
    return (string) $this->t('@context: day or week, date and filters', [
      '@context' => $this->context(),
    ]);
  }

  /**
   * {@inheritdoc}
   */
  public function acceptExposedInput($input): bool {
    $selection = $this->selection();
    $this->value = $selection->valid ? $selection->mode : 'invalid';
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $this->ensureMyTable();
    $query = $this->query;
    if (!$query instanceof Sql) {
      return;
    }
    $selection = $this->selection();
    $group = $this->options['group'];
    foreach ($selection->rowConditions() as [$field, $value, $operator]) {
      $query->addWhere($group, $this->tableAlias . '.' . $field, $value, $operator);
    }
    // Week mode shows the aggregate grid only; it lists no rows and no pager.
    if ($selection->mode === 'week') {
      $query->addWhereExpression($group, '1 = 0');
      return;
    }
    $query->addWhere($group, $this->tableAlias . '.work_date', $selection->start, '>=');
    $query->addWhere($group, $this->tableAlias . '.work_date', $selection->end, '<');
  }

  /**
   * {@inheritdoc}
   *
   * @param mixed $form
   *   Views exposed form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   */
  public function buildExposedForm(&$form, FormStateInterface $form_state): void {
    $selection = $this->selection();
    $this->sanitizeInput($form_state);
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['messages'] = [
      '#type' => 'status_messages',
      '#weight' => -1000,
    ];
    if (!$selection->valid) {
      $this->messenger()->addError($this->t('Choose Day or Week, a calendar date, and filters offered on this page.'));
    }
    $form['mode'] = [
      '#type' => 'hidden',
      '#value' => $selection->mode,
    ];
    $form['mode_switch'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:segmented_control',
      '#props' => [
        'label' => (string) $this->t('Period'),
        'items' => [
          $this->modeItem($selection, 'day', (string) $this->t('Day')),
          $this->modeItem($selection, 'week', (string) $this->t('Week')),
        ],
      ],
    ];
    $form['date'] = [
      '#type' => 'date',
      '#title' => $this->t('Date'),
      '#default_value' => $selection->date,
    ];
    if ($this->context() !== 'project') {
      $form['project'] = $this->picker($selection, 'project', $this->t('Project'), 'project', $this->t('All projects'));
    }
    if ($selection->options['tickets'] !== []) {
      $form['ticket'] = $this->picker($selection, 'ticket', $this->t('Ticket'), 'ticket', $this->t('All tickets'));
    }
    if (count($selection->options['people']) > 1) {
      $form['person'] = $this->picker($selection, 'person', $this->t('Person'), 'user', $this->t('Everyone'));
    }
    foreach (['previous' => $this->t('Previous'), 'today' => $this->t('Today'), 'next' => $this->t('Next')] as $direction => $label) {
      $form[$direction] = [
        '#type' => 'link',
        '#title' => $label,
        '#url' => $this->navigationUrl($selection, $direction),
      ];
    }
    $form['page'] = [
      '#type' => 'hidden',
      '#value' => '0',
    ];
    $form['#cache']['contexts'][] = 'url.query_args';
    $form['#cache']['contexts'][] = 'url.path';
  }

  /**
   * Resolves the current address into a strict selection.
   */
  public function selection(): WorklogSelection {
    return $this->resolvedSelection ??= $this->calendar->selection(
      $this->context(),
      $this->subject(),
      $this->currentUser,
      $this->requestStack->getCurrentRequest()?->query->all() ?? [],
    );
  }

  /**
   * The calendar context of this display.
   */
  public function context(): string {
    $context = (string) $this->options['context'];
    return in_array($context, WorklogSelection::CONTEXTS, TRUE) ? $context : 'workspace';
  }

  /**
   * The route subject: workspace, team, project or account.
   */
  public function subject(): ?EntityInterface {
    $key = match ($this->context()) {
      'personal' => 'user',
      'team' => 'bb_team',
      'project' => 'bb_project',
      default => 'bb_workspace',
    };
    $subject = $this->requestStack->getCurrentRequest()?->attributes->get($key);
    return $subject instanceof EntityInterface ? $subject : NULL;
  }

  /**
   * The calendar address of this display with a query.
   *
   * @param array<string, mixed> $query
   *   Query arguments.
   */
  public function calendarUrl(array $query = []): Url {
    $display = $this->view->current_display ?: 'page';
    $attributes = $this->requestStack->getCurrentRequest()?->attributes;
    $parameters = [];
    $workspace = $attributes?->get('bb_workspace');
    if ($workspace instanceof BbWorkspaceInterface && $this->context() !== 'personal') {
      $parameters['bb_workspace'] = $workspace->getSlug();
    }
    $subject = $this->subject();
    if ($subject !== NULL && $this->context() !== 'workspace') {
      $parameters[$subject->getEntityTypeId()] = (string) $subject->id();
    }
    return Url::fromRoute('view.worklog.' . $display, $parameters, ['query' => $query]);
  }

  /**
   * A Day or Week position that keeps the other query values.
   *
   * @return array{label: string, url: string, active: bool}
   *   Segmented control item.
   */
  private function modeItem(WorklogSelection $selection, string $mode, string $label): array {
    $query = $selection->valid ? $selection->query() : ['date' => $selection->date];
    $query['mode'] = $mode;
    return [
      'label' => $label,
      'url' => $this->calendarUrl($query)->toString(),
      'active' => $selection->mode === $mode,
    ];
  }

  /**
   * A single-value facet picker whose rows are native radios of the form.
   *
   * The facet variant of the list filters: keyboard and no-JavaScript
   * operable, the clear row is an address without this value.
   *
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param string $key
   *   Query key: project, ticket or person.
   * @param mixed $label
   *   Field label.
   * @param string $icon
   *   Sprite symbol.
   * @param mixed $clear_label
   *   Label of the clear row.
   *
   * @return array<string, mixed>
   *   Render array.
   */
  private function picker(WorklogSelection $selection, string $key, mixed $label, string $icon, mixed $clear_label): array {
    $offered = $selection->options[['project' => 'projects', 'ticket' => 'tickets', 'person' => 'people'][$key]];
    $value = $selection->label($key) === '' ? '' : (string) $selection->query()[$key];
    $without = $selection->valid ? $selection->query() : ['mode' => $selection->mode, 'date' => $selection->date];
    unset($without[$key]);
    if ($key === 'project') {
      unset($without['ticket']);
    }
    $rows = [];
    foreach ($offered as $id => $option_label) {
      $rows[] = ['value' => (string) $id, 'label' => $option_label, 'selected' => (string) $id === $value];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:option_picker',
      '#props' => [
        'variant' => 'facet',
        'label' => (string) $label,
        'id' => 'filter-' . $key,
        'icon' => $icon,
        'open' => FALSE,
        'multiple' => FALSE,
        'values' => $value === '' ? [] : [$value],
        'value_labels' => $value === '' ? [] : [$selection->label($key)],
        'searchable' => count($rows) > 6,
      ],
      '#slots' => [
        'options' => [
          '#type' => 'component',
          '#component' => 'bb_theme:option_list',
          '#props' => [
            'multiple' => FALSE,
            'clearable' => TRUE,
            'clear_label' => (string) $clear_label,
            'clear_url' => $this->calendarUrl($without)->toString(),
            'input_name' => $key,
            'input_type' => 'radio',
            'options' => $rows,
          ],
        ],
      ],
    ];
  }

  /**
   * Drops illegal widget values so form elements do not error.
   */
  private function sanitizeInput(FormStateInterface $form_state): void {
    $input = $form_state->getUserInput();
    if (!is_string($input['date'] ?? NULL) || preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $input['date']) !== 1) {
      unset($input['date']);
    }
    foreach (['project', 'ticket', 'person'] as $key) {
      if (isset($input[$key]) && !is_string($input[$key])) {
        unset($input[$key]);
      }
    }
    $form_state->setUserInput($input);
  }

  /**
   * Builds a Previous, Today or Next address.
   */
  private function navigationUrl(WorklogSelection $selection, string $direction): Url {
    $anchor = new \DateTimeImmutable($selection->date);
    $step = $selection->mode === 'week' ? 7 : 1;
    $next = match ($direction) {
      'previous' => $anchor->modify("-$step days"),
      'next' => $anchor->modify("+$step days"),
      default => new \DateTimeImmutable('now', $this->calendar->timezone($this->currentUser)),
    };
    $query = $selection->valid ? $selection->query() : [];
    $query['mode'] = $selection->mode;
    $query['date'] = $next->format('Y-m-d');
    return $this->calendarUrl($query);
  }

}
