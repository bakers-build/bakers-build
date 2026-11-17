<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WeekSheet;
use Drupal\bb_track\WeekSheetCell;
use Drupal\bb_track\WorkTargetOptions;
use Drupal\bb_track\WorklogCalendar;
use Drupal\bb_track\WorklogSelection;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The employee's week as an editable timesheet: one row per project/ticket.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class WorklogWeekForm extends FormBase {

  /**
   * Week reads and the all-or-nothing save.
   */
  protected WeekSheet $sheet;

  /**
   * Row labels.
   */
  protected WorklogCalendar $calendar;

  /**
   * Add-row candidates.
   */
  protected WorkTargetOptions $targets;

  /**
   * The entity type manager.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = new static();
    $form->sheet = $container->get('bb_track.week_sheet');
    $form->calendar = $container->get('bb_track.worklog_calendar');
    $form->targets = $container->get('bb_track.target_options');
    $form->entityTypeManager = $container->get('entity_type.manager');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_week_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?WorklogSelection $selection = NULL): array {
    if (!$selection instanceof WorklogSelection || !$selection->isOwn()) {
      return $form;
    }
    $form_state->set('selection', $selection);
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#attributes']['autocomplete'] = 'off';
    $days = [];
    for ($i = 0; $i < 7; $i++) {
      $days[] = (new \DateTimeImmutable($selection->weekStart))->modify("+$i days")->format('Y-m-d');
    }
    [$table_rows, $recorded] = $this->tableRows($selection, $this->rows($selection), $days, $form_state);
    $form['sheet'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:table',
      '#props' => [
        'variant' => '',
        'live_sums' => TRUE,
        'row_height' => 'md',
        'columns' => $this->columns($recorded),
        'rows' => $table_rows,
      ],
    ];
    $add_row = $this->dialogLink(Url::fromRoute('bb_track.week.add_row'), $this->weekAddress($selection));
    $form['add_row'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => ['library' => ['core/drupal.htmx', 'core/components.bb_theme--option_picker']],
      '#props' => [
        'label' => (string) $this->t('Add row'),
        'href' => $add_row['url'],
        'variant' => 'ghost',
        'attributes' => new Attribute([
          'data-hx-get' => $add_row['hx']['get'],
          'data-hx-target' => $add_row['hx']['target'],
          'data-hx-select' => $add_row['hx']['select'],
          'data-hx-swap' => $add_row['hx']['swap'],
        ]),
      ],
    ];
    $form['actions'] = [
      '#type' => 'actions',
      '#theme_wrappers' => ['container__form_actions'],
      'save' => [
        '#type' => 'submit',
        '#value' => $this->t('Save week'),
        '#bb_variant' => 'success',
        '#theme_wrappers' => ['input__submit__bb_button'],
        '#name' => 'save',
      ],
    ];
    // A second click while the first post runs does not post the grid again.
    $form['#attributes']['x-data'] = '{ sent: false }';
    $form['#attributes']['x-on:submit'] = 'if (sent) { $event.preventDefault() } sent = true';
    $form['#cache']['max-age'] = 0;
    return $form;
  }

  /**
   * A plain address and the htmx attributes that open it in the dialog.
   *
   * @return array{url: string, hx: array<string, string>}
   *   The no-JavaScript href and the dialog trigger.
   */
  private function dialogLink(Url $url, string $destination): array {
    $query = ['destination' => $destination] + ($url->getOption('query') ?? []);
    return [
      'url' => (clone $url)->setOption('query', $query)->toString(),
      'hx' => [
        // The island dialog format, as on the calendar's Record time.
        'get' => (clone $url)->setOption('query', $query + ['_wrapper_format' => 'island_dialog'])->toString(),
        'target' => '#bakers-overlay',
        'select' => 'dialog:not(dialog dialog)',
        'swap' => 'innerHTML',
      ],
    ];
  }

  /**
   * The week's own address, added rows included.
   */
  private function weekAddress(WorklogSelection $selection): string {
    $query = $selection->query();
    $rows = $this->getRequest()->query->get('rows');
    if (is_string($rows) && $rows !== '') {
      $query['rows'] = $rows;
    }
    return Url::fromRoute('<current>', [], ['query' => $query])->toString();
  }

  /**
   * Rows chosen in the Add row dialog that the viewer may record on.
   *
   * @return list<string>
   *   "project:ticket" row keys.
   */
  private function addedRows(): array {
    $rows = [];
    foreach (explode(',', (string) $this->getRequest()->query->get('rows', '')) as $row) {
      if (!preg_match('/^([1-9]\d*):(\d+)$/', $row, $match)) {
        continue;
      }
      [, $project, $ticket] = array_map('intval', $match);
      if (array_key_exists((string) $project, $this->targets->projects()) && ($ticket === 0 || $this->targets->ticketOf($ticket, $project) !== NULL)) {
        $rows[] = $project . ':' . $ticket;
      }
    }
    return $rows;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $cells = [];
    foreach ((array) ($form_state->getUserInput()['cells'] ?? []) as $key => $cell) {
      $parsed = $this->cell((string) $key, is_array($cell) ? $cell : []);
      if ($parsed instanceof WeekSheetCell) {
        $cells[] = $parsed;
      }
    }
    try {
      $selection = $form_state->get('selection');
      $result = $selection instanceof WorklogSelection
        ? $this->sheet->save($cells, $this->shownCells($selection), $selection->submission['id'] ?? NULL)
        : $this->sheet->save($cells);
    }
    catch (\Throwable $error) {
      $this->logger('bb_track')->error('Week save failed: @message', ['@message' => $error->getMessage()]);
      $this->messenger()->addError($this->t('The week could not be saved. Nothing was changed.'));
      $form_state->setRebuild();
      return;
    }
    if ($result['errors'] !== []) {
      $form_state->set('cell_errors', $result['errors']);
      $this->messenger()->addError($this->t('The week was not saved. Correct the marked cells; nothing was changed.'));
      $form_state->setRebuild();
      return;
    }
    $form_state->set('cell_errors', []);
    $this->messenger()->addStatus($this->t('Week saved: @changes, @recorded.', [
      '@changes' => $this->formatPlural($result['changed'], '1 change', '@count changes'),
      '@recorded' => $this->formatPlural($result['recorded'], '1 proposed entry recorded', '@count proposed entries recorded'),
    ]));
    $selection = $form_state->get('selection');
    if ($selection instanceof WorklogSelection) {
      $form_state->setRedirectUrl(Url::fromRoute('<current>', [], ['query' => $selection->query()]));
    }
  }

  /**
   * A submitted cell, or NULL for a malformed key.
   *
   * @param string $key
   *   The "date:project:ticket" cell key.
   * @param array<string, mixed> $cell
   *   Submitted duration, entry and version.
   */
  private function cell(string $key, array $cell): ?WeekSheetCell {
    if (!preg_match('/^(\d{4}-\d{2}-\d{2}):([1-9]\d*):(\d+)$/', $key, $match)) {
      return NULL;
    }
    $entry = (string) ($cell['entry'] ?? '');
    return new WeekSheetCell(
      $match[1],
      (int) $match[2],
      (int) $match[3] === 0 ? NULL : (int) $match[3],
      trim((string) ($cell['duration'] ?? '')),
      ctype_digit($entry) ? (int) $entry : NULL,
      isset($cell['version']) ? (string) $cell['version'] : NULL,
    );
  }

  /**
   * Grid rows: stored cells grouped by project/ticket plus added rows.
   *
   * @return array<string, array<string, list<\Drupal\bb_track\Entity\Worklog>>>
   *   Day cells keyed by "project:ticket", then by date.
   */
  private function rows(WorklogSelection $selection): array {
    $rows = [];
    foreach (array_keys($this->sheet->cells($selection->viewer, $selection->weekStart, $selection->submission['id'] ?? NULL)) as $key) {
      [, $project, $ticket] = explode(':', $key);
      if ($this->isShown($selection, (int) $project, (int) $ticket)) {
        $rows[$project . ':' . $ticket] = [];
      }
    }
    foreach ($this->addedRows() as $key) {
      $rows[$key] = [];
    }
    // A shown row shows every stored day, also those outside the submission:
    // an empty input over a stored entry would make Save stale.
    foreach ($this->sheet->cells($selection->viewer, $selection->weekStart, NULL) as $key => $entries) {
      [$date, $project, $ticket] = explode(':', $key);
      if (isset($rows[$project . ':' . $ticket])) {
        $rows[$project . ':' . $ticket][$date] = $entries;
      }
    }
    return $rows;
  }

  /**
   * Whether the workspace scope and project/ticket filters show a row.
   */
  private function isShown(WorklogSelection $selection, int $project, int $ticket): bool {
    $allowed = $selection->scope['projects'];
    return ($allowed === NULL || in_array($project, $allowed, TRUE))
      && ($selection->project === NULL || $project === $selection->project)
      && ($selection->ticket === NULL || $ticket === $selection->ticket);
  }

  /**
   * Keys of the stored cells the grid shows under the active filters.
   *
   * @return list<string>
   *   "date:project:ticket" keys.
   */
  private function shownCells(WorklogSelection $selection): array {
    $keys = [];
    foreach ($this->rows($selection) as $row_key => $days) {
      foreach (array_keys($days) as $date) {
        $keys[] = $date . ':' . $row_key;
      }
    }
    return $keys;
  }

  /**
   * Table columns: the row label, seven days and the row total.
   *
   * @param array<string, int> $recorded
   *   Recorded seconds per Y-m-d day; each day header carries its total.
   *
   * @return list<array<string, mixed>>
   *   Columns.
   */
  private function columns(array $recorded): array {
    $columns = [['key' => 'label', 'label' => (string) $this->t('Project'), 'row_header' => TRUE]];
    foreach ($recorded as $date => $seconds) {
      $columns[] = [
        'key' => $date,
        'label' => (new \DateTimeImmutable($date))->format('D d'),
        'sublabel' => WorklogFormLayout::formatDuration($seconds),
        'num' => TRUE,
      ];
    }
    $columns[] = ['key' => 'total', 'label' => (string) $this->t('Total'), 'num' => TRUE];
    return $columns;
  }

  /**
   * Table rows with editable cells and the proposed totals.
   *
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The active selection.
   * @param array<string, array<string, list<\Drupal\bb_track\Entity\Worklog>>> $rows
   *   Grid rows.
   * @param list<string> $days
   *   Y-m-d dates.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   *
   * @return array{0: list<array<string, mixed>>, 1: array<string, int>}
   *   Rows of bb_theme:table, and the recorded seconds per day.
   */
  private function tableRows(WorklogSelection $selection, array $rows, array $days, FormStateInterface $form_state): array {
    $errors = $form_state->get('cell_errors') ?? [];
    $typed = (array) ($form_state->getUserInput()['cells'] ?? []);
    $recorded = $proposed = array_fill_keys($days, 0);
    $proposal = $this->openProposal($selection);
    $table = [];
    $focus = TRUE;
    uksort($rows, fn (string $a, string $b): int => strnatcasecmp($this->rowLabel($a), $this->rowLabel($b)));
    foreach ($rows as $row_key => $cells) {
      $label = $this->rowLabel($row_key);
      $out = ['label' => ['kind' => 'text', 'value' => $label]];
      $row_total = 0;
      foreach ($days as $date) {
        $entries = $cells[$date] ?? [];
        $key = $date . ':' . $row_key;
        $row_total += $this->tally($entries, $date, $recorded, $proposed);
        $error = $errors[$key] ?? NULL;
        $out[$date] = $this->dayCell(
          $selection,
          $key,
          $date,
          $row_key,
          $entries,
          is_array($typed[$key] ?? NULL) ? $typed[$key] : [],
          $error,
          $error !== NULL && $focus,
        );
        if (($out[$date]['kind'] ?? '') === 'input') {
          $out[$date] += $this->cellSums($date, $row_key, $entries, $proposal);
        }
        $focus = $focus && $error === NULL;
      }
      $out['total'] = [
        'kind' => 'text',
        'value' => WorklogFormLayout::formatDuration($row_total),
        'sum' => 'row:' . $row_key,
        'seconds' => $row_total,
      ];
      $table[] = ['cells' => $out];
    }
    if (array_sum($proposed) > 0 || $proposal) {
      $table[] = ['cells' => $this->totalRow((string) $this->t('Proposed — not yet recorded'), $proposed, 'faint', 'proposed')];
    }
    return [$table, $recorded];
  }

  /**
   * Adds a cell's stored seconds to the recorded or proposed day totals.
   *
   * @param list<\Drupal\bb_track\Entity\Worklog> $entries
   *   Live entries of the cell.
   * @param string $date
   *   Y-m-d.
   * @param array<string, int> $recorded
   *   Recorded seconds per day.
   * @param array<string, int> $proposed
   *   Proposed seconds per day.
   *
   * @return int
   *   The cell's seconds.
   */
  private function tally(array $entries, string $date, array &$recorded, array &$proposed): int {
    $sum = 0;
    foreach ($entries as $entry) {
      $seconds = (int) $entry->get('duration_seconds')->value;
      $sum += $seconds;
      $entry->get('state')->value === 'proposed' ? $proposed[$date] += $seconds : $recorded[$date] += $seconds;
    }
    return $sum;
  }

  /**
   * The totals a cell's typed value moves before Save.
   *
   * A proposed cell, and an empty cell while a proposal is reviewed, move the
   * draft total; every cell moves its row total.
   *
   * @param string $date
   *   Y-m-d.
   * @param string $row_key
   *   The "project:ticket" row key.
   * @param list<\Drupal\bb_track\Entity\Worklog> $entries
   *   Live entries of the cell.
   * @param bool $proposal
   *   TRUE while an open proposal is reviewed.
   *
   * @return array{stored: int, sums: list<string>}
   *   Stored seconds and total keys.
   */
  private function cellSums(string $date, string $row_key, array $entries, bool $proposal): array {
    $entry = $entries[0] ?? NULL;
    $sums = ['row:' . $row_key];
    if ($entry instanceof Worklog ? $entry->get('state')->value === 'proposed' : $proposal) {
      $sums = [...$sums, 'proposed:' . $date, 'proposed:total'];
    }
    return [
      'stored' => $entry instanceof Worklog ? (int) $entry->get('duration_seconds')->value : 0,
      'sums' => $sums,
    ];
  }

  /**
   * Whether the grid reviews the viewer's open proposal.
   */
  private function openProposal(WorklogSelection $selection): bool {
    $id = $selection->submission['id'] ?? NULL;
    $submission = $id === NULL ? NULL : $this->entityTypeManager->getStorage('bb_track_submission')->load($id);
    return $submission instanceof Submission && $submission->get('state')->value === 'proposed';
  }

  /**
   * One day cell: an input for zero or one entry, a locked link otherwise.
   *
   * @param \Drupal\bb_track\WorklogSelection $selection
   *   The active selection.
   * @param string $key
   *   The "date:project:ticket" cell key.
   * @param string $date
   *   Y-m-d date of the cell.
   * @param string $row_key
   *   The "project:ticket" row key.
   * @param list<\Drupal\bb_track\Entity\Worklog> $entries
   *   Live entries of the cell.
   * @param array<string, mixed> $posted
   *   The duration, entry and version last posted for this cell, if any.
   * @param string|null $error
   *   Validation error for this cell, or NULL.
   * @param bool $focus
   *   TRUE when this cell should receive autofocus.
   *
   * @return array<string, mixed>
   *   Cell of bb_theme:table.
   *
   * @SuppressWarnings("PHPMD.ExcessiveParameterList")
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function dayCell(WorklogSelection $selection, string $key, string $date, string $row_key, array $entries, array $posted, ?string $error, bool $focus): array {
    $typed = $posted['duration'] ?? NULL;
    $label = (new \DateTimeImmutable($date))->format('D d') . ' · ' . $this->rowLabel($row_key);
    $sum = array_sum(array_map(static fn (Worklog $entry): int => (int) $entry->get('duration_seconds')->value, $entries));
    if (count($entries) > 1) {
      return $this->multiEntryCell($date, $row_key, $sum, count($entries));
    }
    $entry = $entries[0] ?? NULL;
    if ($entry instanceof Worklog && $entry->get('state')->value === 'approved') {
      return ['kind' => 'text', 'value' => WorklogFormLayout::formatDuration($sum)];
    }
    $cell = [
      'kind' => 'input',
      'name' => 'cells[' . $key . '][duration]',
      'value' => is_string($typed) ? $typed : ($entry ? WorklogFormLayout::formatDuration($sum) : ''),
      'label' => $label,
    ];
    if ($entry instanceof Worklog) {
      $cell += $this->entryCellDetails($selection, $key, $entry);
    }
    if ($error !== NULL) {
      $cell['error'] = $error;
      $cell['autofocus'] = $focus;
      // A refused cell keeps the entry and version it was edited against, so
      // a retry cannot silently overwrite the change that made it stale.
      foreach (['entry', 'version'] as $field) {
        if (is_string($posted[$field] ?? NULL)) {
          $cell['hidden']['cells[' . $key . '][' . $field . ']'] = $posted[$field];
        }
      }
    }
    return $cell;
  }

  /**
   * The locked link cell shown for more than one entry on a day.
   *
   * @return array<string, mixed>
   *   Cell of bb_theme:table.
   */
  private function multiEntryCell(string $date, string $row_key, int $sum, int $count): array {
    [$project, $ticket] = array_map('intval', explode(':', $row_key));
    $query = ['mode' => 'day', 'date' => $date, 'project' => (string) $project] + ($ticket > 0 ? ['ticket' => (string) $ticket] : []);
    return [
      'kind' => 'link',
      'value' => (string) $this->t('@total · @count entries', [
        '@total' => WorklogFormLayout::formatDuration($sum),
        '@count' => $count,
      ]),
      'url' => Url::fromRoute('<current>', [], ['query' => $query])->toString(),
    ];
  }

  /**
   * Hidden fields, edit link and hint added when a cell has a live entry.
   *
   * @return array<string, mixed>
   *   Additional cell keys.
   */
  private function entryCellDetails(WorklogSelection $selection, string $key, Worklog $entry): array {
    $edit = $this->dialogLink(Url::fromRoute('bb_track.worklog.edit', ['bb_track_worklog' => $entry->uuid()]), $this->weekAddress($selection));
    $details = [
      'hidden' => [
        'cells[' . $key . '][entry]' => (string) $entry->id(),
        'cells[' . $key . '][version]' => $entry->version(),
      ],
      'url' => $edit['url'],
      'hx' => $edit['hx'],
      'url_label' => (string) $this->t('Details'),
    ];
    if ($entry->get('state')->value === 'proposed') {
      $details['hint'] = (string) $this->t('Proposed');
    }
    return $details;
  }

  /**
   * A totals row.
   *
   * @param string $label
   *   The row label.
   * @param array<string, int> $days
   *   Seconds per day.
   * @param string $emphasis
   *   Emphasis style for the row.
   * @param string|null $sum
   *   Prefix of the live total keys, or NULL for a stored-only line.
   *
   * @return array<string, array<string, mixed>>
   *   Cells.
   */
  private function totalRow(string $label, array $days, string $emphasis, ?string $sum = NULL): array {
    $cells = ['label' => ['kind' => 'text', 'value' => $label, 'emphasis' => $emphasis]];
    foreach ([...$days, 'total' => array_sum($days)] as $date => $seconds) {
      $cells[$date] = [
        'kind' => 'text',
        'value' => WorklogFormLayout::formatDuration($seconds),
        'emphasis' => $emphasis,
      ] + ($sum === NULL ? [] : ['sum' => $sum . ':' . $date, 'seconds' => $seconds]);
    }
    return $cells;
  }

  /**
   * The "Customer · Project · KEY-1 Title" label of a row key.
   */
  private function rowLabel(string $row_key): string {
    [$project_id, $ticket_id] = array_map('intval', explode(':', $row_key));
    $project = $this->entityTypeManager->getStorage('bb_project')->load($project_id);
    if (!$project instanceof BbProjectInterface || !$project->access('view')) {
      return (string) $this->t('Unresolved project');
    }
    $label = $this->calendar->projectLabel($project);
    if ($ticket_id > 0) {
      $ticket = $this->entityTypeManager->getStorage('bb_ticket')->load($ticket_id);
      $label .= ' · ' . ($ticket instanceof BbTicketInterface && $ticket->access('view') ? $this->calendar->ticketLabel($ticket) : (string) $this->t('Unresolved ticket'));
    }
    return $label;
  }

}
