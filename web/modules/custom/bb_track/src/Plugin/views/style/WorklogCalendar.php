<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\views\style;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Form\SubmissionActionForm;
use Drupal\bb_track\Form\WorklogFormLayout;
use Drupal\bb_track\Form\WorklogWeekForm;
use Drupal\bb_track\Plugin\views\filter\WorklogPeriod;
use Drupal\bb_track\WorklogAggregates;
use Drupal\bb_track\WorklogCalendar as Calendar;
use Drupal\bb_track\WorklogSelection;
use Drupal\user\UserInterface;
use Drupal\views\Attribute\ViewsStyle;
use Drupal\views\Plugin\views\style\StylePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Renders the time calendar: week strip, day rows or week grid, total.
 *
 * Hands plain data to the presenter template; every total comes from
 * WorklogAggregates over the same selection the rows use.
 */
#[ViewsStyle(
  id: 'bb_worklog_calendar',
  title: new TranslatableMarkup('Time calendar'),
  help: new TranslatableMarkup('Week strip with daily totals, day rows or a week grid.'),
  theme: 'views_view_bb_worklog_calendar',
  display_types: ['normal'],
)]
final class WorklogCalendar extends StylePluginBase {

  /**
   * {@inheritdoc}
   *
   * @var bool
   */
  protected $usesRowPlugin = FALSE;

  /**
   * {@inheritdoc}
   *
   * @var bool
   */
  protected $usesFields = FALSE;

  /**
   * {@inheritdoc}
   *
   * @var bool
   */
  protected $usesGrouping = FALSE;

  /**
   * {@inheritdoc}
   *
   * @var bool
   */
  protected $usesRowClass = FALSE;

  /**
   * Totals source.
   */
  private WorklogAggregates $aggregates;

  /**
   * Label source.
   */
  private Calendar $calendar;

  /**
   * Builds the week and proposal forms.
   */
  private FormBuilderInterface $formBuilder;

  /**
   * The entity type manager.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->aggregates = $container->get('bb_track.worklog_aggregates');
    $instance->calendar = $container->get('bb_track.worklog_calendar');
    $instance->formBuilder = $container->get('form_builder');
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function evenEmpty(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function render(): array {
    $filter = $this->periodFilter();
    if (!$filter instanceof WorklogPeriod) {
      return [];
    }
    $selection = $filter->selection();
    $days = $this->aggregates->secondsByDay($selection);
    $is_day = $selection->mode === 'day';
    // Week mode carries the day totals in the table head and states the week
    // total once; day mode keeps the strip as its day navigator.
    $calendar = [
      'scope' => $this->scopeSentence($filter),
      'strip' => $is_day ? $this->strip($filter, $selection, $days) : NULL,
      'mode' => $selection->mode,
      'total' => $is_day
        ? (string) $this->t('Total recorded time: @total', ['@total' => WorklogFormLayout::formatDuration($days[$selection->date] ?? 0)])
        : (string) $this->t('Week total @total', ['@total' => WorklogFormLayout::formatDuration(array_sum($days))]),
      'rows' => $selection->mode === 'day' ? $this->dayRows($filter) : [],
      'grid' => $selection->mode === 'week' && !$selection->isOwn() ? $this->weekGrid($filter, $selection, $days) : NULL,
      'week_form' => NULL,
      'proposal' => NULL,
      'proposed_total' => NULL,
      'clear_filters' => $this->clearFiltersUrl($filter, $selection),
    ];
    $proposed = $this->aggregates->proposedSeconds($selection);
    // In week mode the own timesheet carries proposals as a table row.
    if ($proposed > 0 && $is_day) {
      $calendar['proposed_total'] = (string) $this->t('Proposed — not yet recorded: @total', [
        '@total' => WorklogFormLayout::formatDuration($proposed),
      ]);
    }
    $calendar = $this->attachOwnWeekExtras($calendar, $selection, $proposed);
    $nothing = $this->isNothing($calendar, $days, $proposed);
    $calendar['empty'] = $nothing ? (string) $this->t('No time entries for this period.') : NULL;
    // Views auto-registers style themes with view/options/rows/title only, so
    // the calendar travels in #rows.
    return [
      [
        '#theme' => $this->themeFunctions(),
        '#view' => $this->view,
        '#rows' => $calendar,
        '#cache' => [
          'contexts' => ['user', 'url.query_args', 'url.path'],
          'tags' => ['bb_track_worklog_list', 'og_membership_list'],
        ],
      ],
    ];
  }

  /**
   * Adds the own-week form and proposal bar when viewing one's own week.
   *
   * @param array<string, mixed> $calendar
   *   Calendar data so far.
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param int $proposed
   *   Proposed seconds for the week.
   *
   * @return array<string, mixed>
   *   Calendar data with the week form and proposal bar added.
   */
  private function attachOwnWeekExtras(array $calendar, WorklogSelection $selection, int $proposed): array {
    if ($selection->mode !== 'week' || !$selection->isOwn()) {
      return $calendar;
    }
    $calendar['week_form'] = $this->formBuilder->getForm(WorklogWeekForm::class, $selection);
    $calendar['proposal'] = $this->proposalBar($selection, $proposed);
    return $calendar;
  }

  /**
   * Whether the calendar has nothing to show for this period.
   *
   * @param array<string, mixed> $calendar
   *   Calendar data so far.
   * @param array<string, int> $days
   *   Seconds per day.
   * @param int $proposed
   *   Proposed seconds for the week.
   */
  private function isNothing(array $calendar, array $days, int $proposed): bool {
    if ($calendar['week_form'] === NULL) {
      return $calendar['rows'] === [] && ($calendar['grid']['rows'] ?? []) === [];
    }
    return array_sum($days) + $proposed === 0;
  }

  /**
   * The proposal bar: a sentence and Discard/Submit for the week's proposals.
   *
   * @return array{text: string, actions: array<string, mixed>}|null
   *   Bar data, or NULL when nothing is proposed or selected.
   */
  private function proposalBar(WorklogSelection $selection, int $proposed): ?array {
    $storage = $this->entityTypeManager->getStorage('bb_track_worklog');
    $week_end = (new \DateTimeImmutable($selection->weekEnd))->modify('-1 day')->format('Y-m-d');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $selection->viewer)
      ->condition('state', 'proposed')
      ->condition('voided', 0)
      ->condition('work_date', [$selection->weekStart, $week_end], 'BETWEEN')
      ->execute();
    $submission_ids = [];
    foreach ($storage->loadMultiple($ids) as $row) {
      assert($row instanceof Worklog);
      $submission_ids[(int) $row->get('submission_id')->target_id] = TRUE;
    }
    if ($selection->submission !== NULL) {
      $submission_ids[$selection->submission['id']] = TRUE;
    }
    $submissions = array_values($this->entityTypeManager->getStorage('bb_track_submission')->loadMultiple(array_keys($submission_ids)));
    if ($submissions === []) {
      return NULL;
    }
    return [
      'text' => $proposed > 0
        ? (string) $this->formatPlural(count($ids), 'AI proposal · 1 entry · @total — review and Save week to record it', 'AI proposal · @count entries · @total — review and Save week to record them', [
          '@total' => WorklogFormLayout::formatDuration($proposed),
        ])
        : (string) $this->t('Submission of this week'),
      'actions' => $this->formBuilder->getForm(SubmissionActionForm::class, $submissions),
    ];
  }

  /**
   * The calendar's period filter.
   */
  private function periodFilter(): ?WorklogPeriod {
    foreach ($this->view->filter as $filter) {
      if ($filter instanceof WorklogPeriod) {
        return $filter;
      }
    }
    return NULL;
  }

  /**
   * The sentence naming the active scope.
   */
  private function scopeSentence(WorklogPeriod $filter): string {
    $label = $filter->subject()?->label() ?? '';
    return (string) match ($filter->context()) {
      'personal' => $this->t('Your recorded hours in all workspaces'),
      'team' => $this->t('Recorded hours of @team members', ['@team' => $label]),
      'project' => $this->t('Recorded hours on @project', ['@project' => $label]),
      default => $this->t('Your recorded hours in @workspace', ['@workspace' => $label]),
    };
  }

  /**
   * Week strip props.
   *
   * @param \Drupal\bb_track\Plugin\views\filter\WorklogPeriod $filter
   *   The period filter.
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param array<string, int> $days
   *   Seconds per day.
   *
   * @return array<string, mixed>
   *   Props of bb_theme:week-strip.
   */
  private function strip(WorklogPeriod $filter, WorklogSelection $selection, array $days): array {
    $items = [];
    foreach ($days as $date => $seconds) {
      $day = new \DateTimeImmutable($date);
      $total = WorklogFormLayout::formatDuration($seconds);
      $items[] = [
        'weekday' => $day->format('D'),
        'date' => $day->format('d'),
        'total' => $total,
        'url' => $this->dayUrl($filter, $selection, $date, [])->toString(),
        'active' => $selection->mode === 'day' && $selection->date === $date,
        'aria_label' => $day->format('D Y-m-d') . ', ' . $total,
      ];
    }
    return [
      'label' => (string) $this->t('Days of week @date', ['@date' => $selection->weekStart]),
      'days' => $items,
      'total_label' => (string) $this->t('Week total'),
      'total' => WorklogFormLayout::formatDuration(array_sum($days)),
    ];
  }

  /**
   * Day list items of the current page.
   *
   * @return list<array<string, mixed>>
   *   Items of bb_theme:list.
   */
  private function dayRows(WorklogPeriod $filter): array {
    $show_person = in_array($filter->context(), ['team', 'project'], TRUE);
    $destination = $filter->calendarUrl($filter->selection()->query())->toString();
    $items = [];
    foreach ($this->view->result as $row) {
      $entry = $row->_entity;
      if (!$entry instanceof Worklog) {
        continue;
      }
      $cells = [
        'project' => $this->projectCell($entry),
        'description' => ['kind' => 'text', 'value' => (string) $entry->get('description')->value],
        'duration' => [
          'kind' => 'text',
          'value' => WorklogFormLayout::formatDuration((int) $entry->get('duration_seconds')->value),
        ],
      ];
      $ticket = $this->ticketCell($entry);
      if ($ticket !== NULL) {
        $cells['ticket'] = $ticket;
      }
      if ($entry->get('state')->value === 'proposed') {
        $cells['state'] = ['kind' => 'badge', 'label' => (string) $this->t('Proposed'), 'tone' => 'neutral'];
      }
      $owner = $entry->get('owner_user_id')->entity;
      if ($show_person && $owner instanceof UserInterface) {
        $cells['person'] = ['kind' => 'text', 'value' => (string) $owner->getDisplayName(), 'emphasis' => 'faint'];
      }
      if ($entry->access('update')) {
        $cells['open'] = [
          'kind' => 'link',
          'value' => (string) $this->t('Open'),
          'full_load' => TRUE,
          'url' => Url::fromRoute('bb_track.worklog.edit', [
            'bb_track_worklog' => $entry->uuid(),
          ], ['query' => ['destination' => $destination]])->toString(),
        ];
      }
      $items[] = ['cells' => $cells];
    }
    return $items;
  }

  /**
   * Project cell: "Customer · Project" link, or Unresolved project.
   *
   * @return array<string, mixed>
   *   Cell.
   */
  private function projectCell(Worklog $entry): array {
    $project = $entry->get('project_id')->entity;
    if (!$project instanceof BbProjectInterface || !$project->access('view')) {
      return ['kind' => 'text', 'value' => (string) $this->t('Unresolved project')];
    }
    return $this->linkCell($project, $this->calendar->projectLabel($project));
  }

  /**
   * Ticket cell, Unresolved ticket, or NULL when the entry has none.
   *
   * @return array<string, mixed>|null
   *   Cell.
   */
  private function ticketCell(Worklog $entry): ?array {
    if ($entry->get('ticket_id')->isEmpty()) {
      return NULL;
    }
    $ticket = $entry->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface || !$ticket->access('view')) {
      return ['kind' => 'text', 'value' => (string) $this->t('Unresolved ticket'), 'emphasis' => 'faint'];
    }
    return $this->linkCell($ticket, $this->calendar->ticketLabel($ticket));
  }

  /**
   * A link cell to an entity's canonical page.
   *
   * @return array<string, mixed>
   *   Cell.
   */
  private function linkCell(EntityInterface $entity, string $label): array {
    return ['kind' => 'link', 'value' => $label, 'url' => $entity->toUrl()->toString()];
  }

  /**
   * Read-only week grid: rows by person or by project and ticket.
   *
   * @param \Drupal\bb_track\Plugin\views\filter\WorklogPeriod $filter
   *   The period filter.
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param array<string, int> $days
   *   Seconds per day, the totals row.
   *
   * @return array{columns: list<array<string, mixed>>, rows: list<array<string, mixed>>}
   *   Props of bb_theme:table.
   */
  private function weekGrid(WorklogPeriod $filter, WorklogSelection $selection, array $days): array {
    $by_person = in_array($filter->context(), ['team', 'project'], TRUE);
    $columns = [
      [
        'key' => 'label',
        'label' => (string) ($by_person ? $this->t('Person') : $this->t('Project')),
        'row_header' => TRUE,
      ],
    ];
    foreach (array_keys($days) as $date) {
      $columns[] = [
        'key' => $date,
        'label' => (new \DateTimeImmutable($date))->format('D d'),
        'sublabel' => WorklogFormLayout::formatDuration($days[$date]),
        'num' => TRUE,
      ];
    }
    $columns[] = ['key' => 'total', 'label' => (string) $this->t('Total'), 'num' => TRUE];
    $rows = [];
    foreach ($this->aggregates->grid($selection, $by_person ? 'person' : 'project_ticket') as $grid_row) {
      $cells = ['label' => ['kind' => 'text', 'value' => $grid_row['label']]];
      foreach ($grid_row['days'] as $date => $seconds) {
        $cells[$date] = $this->gridCell($filter, $selection, $date, $seconds, $grid_row['filter']);
      }
      $cells['total'] = ['kind' => 'text', 'value' => WorklogFormLayout::formatDuration($grid_row['total'])];
      $rows[] = ['cells' => $cells];
    }
    return ['columns' => $columns, 'rows' => $rows, 'row_height' => 'md'];
  }

  /**
   * One grid cell: a link to that day filtered to the row, or a dash.
   *
   * @param \Drupal\bb_track\Plugin\views\filter\WorklogPeriod $filter
   *   The period filter.
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param string $date
   *   Y-m-d.
   * @param int $seconds
   *   Recorded seconds.
   * @param array<string, int> $row_filter
   *   The row's filter values.
   *
   * @return array<string, mixed>
   *   Cell.
   */
  private function gridCell(WorklogPeriod $filter, WorklogSelection $selection, string $date, int $seconds, array $row_filter): array {
    if ($seconds === 0) {
      return ['kind' => 'text', 'value' => '–', 'emphasis' => 'faint'];
    }
    $value = WorklogFormLayout::formatDuration($seconds);
    if ($row_filter === []) {
      return ['kind' => 'text', 'value' => $value];
    }
    return [
      'kind' => 'link',
      'value' => $value,
      'url' => $this->dayUrl($filter, $selection, $date, $row_filter)->toString(),
    ];
  }

  /**
   * The same period without project, ticket or person filters, if any is set.
   */
  private function clearFiltersUrl(WorklogPeriod $filter, WorklogSelection $selection): ?string {
    if (!$selection->valid || ($selection->project ?? $selection->ticket ?? $selection->person) === NULL) {
      return NULL;
    }
    $query = array_diff_key($selection->query(), array_flip(['project', 'ticket', 'person']));
    return $filter->calendarUrl($query)->toString();
  }

  /**
   * Day address keeping the current filters, narrowed by extra values.
   *
   * @param \Drupal\bb_track\Plugin\views\filter\WorklogPeriod $filter
   *   The period filter.
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The selection.
   * @param string $date
   *   Y-m-d.
   * @param array<string, int> $narrow
   *   Extra filter values.
   */
  private function dayUrl(WorklogPeriod $filter, WorklogSelection $selection, string $date, array $narrow): Url {
    $query = $selection->valid ? $selection->query() : [];
    $query['mode'] = 'day';
    $query['date'] = $date;
    foreach ($narrow as $key => $value) {
      $query[$key] = (string) $value;
    }
    return $filter->calendarUrl($query);
  }

}
