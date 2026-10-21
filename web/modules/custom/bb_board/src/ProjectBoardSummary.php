<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * Turns the Project Board summary's aggregations into labelled rows.
 *
 * @see \Drupal\bb_board\Plugin\views\area\BbBoardSummary
 */
final class ProjectBoardSummary {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Per-person counts: count descending, then name, then account id.
   *
   * A chip with nothing to show is left out — it would filter to nothing —
   * unless it is the active selection, which must stay clearable.
   *
   * @param list<array{filter: string, count: int}> $rows
   *   The employee aggregation.
   * @param list<string> $active
   *   The Assignee values in the request.
   * @param string|null $token
   *   The Assignee facet's value for "no assignee", NULL when it has none.
   *
   * @return list<array{value: ?string, label: string, count: int, active: bool, tone?: string}>
   *   One entry per person, then Unassigned (`tone` wait).
   */
  public function employees(array $rows, array $active, ?string $token): array {
    $counts = [];
    $unassigned = 0;
    foreach ($rows as $row) {
      $value = trim((string) $row['filter'], '"');
      if ($value === '!') {
        $unassigned += (int) $row['count'];
        continue;
      }
      $counts[$value] = (int) $row['count'];
    }
    foreach ($active as $value) {
      if (ctype_digit($value)) {
        $counts[$value] ??= 0;
      }
    }

    $people = [];
    $accounts = $this->entityTypeManager->getStorage('user')->loadMultiple(array_keys($counts));
    foreach ($counts as $id => $count) {
      $account = $accounts[$id] ?? NULL;
      if (!$account instanceof AccountInterface) {
        $unassigned += $count;
        continue;
      }
      $people[] = [
        'value' => (string) $id,
        'label' => (string) $account->getDisplayName(),
        'count' => $count,
        'active' => in_array((string) $id, $active, TRUE),
      ];
    }
    usort($people, static fn (array $a, array $b): int => [$b['count'], mb_strtolower($a['label']), (int) $a['value']]
      <=> [$a['count'], mb_strtolower($b['label']), (int) $b['value']]);

    $unassigned_active = $token !== NULL && in_array($token, $active, TRUE);
    if ($unassigned > 0 || $unassigned_active) {
      $people[] = [
        'value' => $token,
        'label' => (string) new TranslatableMarkup('Unassigned'),
        'count' => $unassigned,
        'active' => $unassigned_active,
        'tone' => 'wait',
      ];
    }
    return $people;
  }

  /**
   * Per-state counts in workflow-definition order.
   *
   * Only states with tickets, or the active selection, get a chip. A stored
   * state no workflow declares keeps its value as its label.
   *
   * @param list<array{filter: string, count: int}> $rows
   *   The state aggregation.
   * @param list<string> $active
   *   The State values in the request.
   *
   * @return list<array{value: string, label: string, count: int, active: bool}>
   *   One entry per state.
   */
  public function states(array $rows, array $active = []): array {
    $counts = [];
    foreach ($rows as $row) {
      $counts[trim((string) $row['filter'], '"')] = (int) $row['count'];
    }
    $states = [];
    foreach (TypeWorkflows::ticketStateOptions() as $value => $label) {
      $count = $counts[$value] ?? 0;
      unset($counts[$value]);
      if ($count > 0 || in_array((string) $value, $active, TRUE)) {
        $states[] = [
          'value' => (string) $value,
          'label' => $label,
          'count' => $count,
          'active' => in_array((string) $value, $active, TRUE),
        ];
      }
    }
    foreach ($counts as $value => $count) {
      $value = (string) $value;
      $label = $value === '!' || $value === '' ? (string) new TranslatableMarkup('Unknown state') : $value;
      $states[] = ['value' => $value, 'label' => $label, 'count' => $count, 'active' => in_array($value, $active, TRUE)];
    }
    return $states;
  }

  /**
   * Per-priority counts: High, Medium, Low, then no priority.
   *
   * @param list<array{filter: string, count: int}> $rows
   *   The priority aggregation.
   * @param list<string> $active
   *   The Priority values in the request.
   * @param string|null $token
   *   The Priority facet's value for "no priority", NULL when it has none.
   *
   * @return list<array{value: ?string, label: string, count: int, active: bool, tone?: string}>
   *   One entry per priority with tickets, or active. High is `critical`.
   */
  public function priorities(array $rows, array $active, ?string $token): array {
    $counts = [];
    foreach ($rows as $row) {
      $counts[trim((string) $row['filter'], '"')] = (int) $row['count'];
    }
    $labels = [
      '1' => new TranslatableMarkup('High'),
      '2' => new TranslatableMarkup('Medium'),
      '3' => new TranslatableMarkup('Low'),
      '!' => new TranslatableMarkup('No priority'),
    ];
    $priorities = [];
    foreach ($labels as $value => $label) {
      $value = (string) $value;
      $chip = $value === '!' ? $token : $value;
      $is_active = $chip !== NULL && in_array($chip, $active, TRUE);
      $count = $counts[$value] ?? 0;
      if ($count > 0 || $is_active) {
        $row = ['value' => $chip, 'label' => (string) $label, 'count' => $count, 'active' => $is_active];
        if ($value === '1') {
          $row['tone'] = 'critical';
        }
        $priorities[] = $row;
      }
    }
    return $priorities;
  }

  /**
   * Per-work-state counts in column order: Not assigned, Intake, Working, Done.
   *
   * @param list<array{filter: string, count: int}> $rows
   *   The work_state aggregation.
   * @param list<string> $active
   *   The Work state values in the request.
   *
   * @return list<array{value: string, label: string, count: int, active: bool, tone?: string}>
   *   All four work states, then any unexpected aggregation keys.
   */
  public function workStates(array $rows, array $active = []): array {
    $counts = [];
    foreach ($rows as $row) {
      $counts[trim((string) $row['filter'], '"')] = (int) $row['count'];
    }
    $labels = [
      'not_assigned' => [new TranslatableMarkup('Not assigned'), 'wait'],
      'intake' => [new TranslatableMarkup('Intake'), 'attention'],
      'working' => [new TranslatableMarkup('Working'), 'running'],
      'done' => [new TranslatableMarkup('Done'), 'idle'],
    ];
    $states = [];
    foreach ($labels as $value => [$label, $tone]) {
      $count = $counts[$value] ?? 0;
      unset($counts[$value]);
      $states[] = [
        'value' => $value,
        'label' => (string) $label,
        'count' => $count,
        'active' => in_array($value, $active, TRUE),
        'tone' => $tone,
      ];
    }
    foreach ($counts as $value => $count) {
      $value = (string) $value;
      if ($value === '!' || $value === '') {
        continue;
      }
      $states[] = [
        'value' => $value,
        'label' => $value,
        'count' => $count,
        'active' => in_array($value, $active, TRUE),
      ];
    }
    return $states;
  }

  /**
   * Per-parent counts: eligible parents, count descending, then label.
   *
   * Aggregation keys are parent entity ids. Chip values are ticket UUIDs,
   * matching BbBoardParent's exposed identifier.
   *
   * @param list<array{filter: string, count: int}> $rows
   *   The parent_id aggregation.
   * @param array<string, string> $options
   *   UUID => "IDENTIFIER Title" from ParentTicketScope::options().
   * @param list<string> $active
   *   The Parent values in the request.
   *
   * @return list<array{value: string, label: string, title: string, count: int, active: bool}>
   *   Eligible parents. `label` is the identifier, `title` the hover text.
   */
  public function parents(array $rows, array $options, array $active): array {
    $counts = $this->parentCountsByUuid($rows);
    $parents = [];
    foreach ($options as $uuid => $combined) {
      $parents[] = $this->parentChip(
        $uuid,
        $combined,
        $counts[$uuid] ?? 0,
        in_array($uuid, $active, TRUE),
      );
    }
    $seen = array_column($parents, 'value');
    foreach ($active as $uuid) {
      if (in_array($uuid, $seen, TRUE)) {
        continue;
      }
      $parents[] = $this->parentChip($uuid, $options[$uuid] ?? $uuid, $counts[$uuid] ?? 0, TRUE);
    }
    usort($parents, static fn (array $a, array $b): int => [$b['count'], mb_strtolower($a['label']), $a['value']]
      <=> [$a['count'], mb_strtolower($b['label']), $b['value']]);
    return $parents;
  }

  /**
   * Aggregation counts keyed by parent ticket UUID.
   *
   * @param list<array{filter: string, count: int}> $rows
   *   The parent_id aggregation (entity ids).
   *
   * @return array<string, int>
   *   UUID => count for indexed parents.
   */
  private function parentCountsByUuid(array $rows): array {
    $by_id = [];
    foreach ($rows as $row) {
      $id = trim((string) $row['filter'], '"');
      if ($id === '!' || $id === '') {
        continue;
      }
      $by_id[$id] = (int) $row['count'];
    }
    if ($by_id === []) {
      return [];
    }
    $counts = [];
    foreach ($this->entityTypeManager->getStorage('bb_ticket')->loadMultiple(array_keys($by_id)) as $id => $ticket) {
      if ($ticket instanceof BbTicketInterface) {
        $counts[$ticket->uuid()] = $by_id[$id];
      }
    }
    return $counts;
  }

  /**
   * One parent chip: identifier on the chip, title on hover.
   *
   * @return array{value: string, label: string, title: string, count: int, active: bool}
   *   Identifier on `label`, ticket title on `title`.
   */
  private function parentChip(string $uuid, string $combined, int $count, bool $active): array {
    $parts = explode(' ', $combined, 2);
    return [
      'value' => $uuid,
      'label' => $parts[0],
      'title' => $parts[1] ?? '',
      'count' => $count,
      'active' => $active,
    ];
  }

}
