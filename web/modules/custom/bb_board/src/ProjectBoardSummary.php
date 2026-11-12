<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_board\Plugin\views\area\BbBoardSummary;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Ticket\TicketSearchResolver;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\search_api\Entity\Index;
use Drupal\search_api\SearchApiException;
use Psr\Log\LoggerInterface;

/**
 * Turns the Project Board summary's aggregations into labelled rows and counts.
 *
 * @see \Drupal\bb_board\Plugin\views\area\BbBoardSummary
 */
final class ProjectBoardSummary {

  use PersonIdentityTrait;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TicketSearchResolver $resolver,
    private readonly LoggerInterface $logger,
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
   * @return list<array{value: ?string, label: string, count: int, active: bool, initials?: string, color?: string, tone?: string}>
   *   One entry per person with their avatar mark, then Unassigned (`tone`
   *   wait).
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
      $label = (string) $account->getDisplayName();
      $people[] = [
        'value' => (string) $id,
        'label' => $label,
        'count' => $count,
        'active' => in_array((string) $id, $active, TRUE),
        'initials' => $this->personInitials($label),
        'color' => $this->personColor((int) $id),
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
   * Counts a board's focus, optionally narrowed to ticket ids or a search line.
   *
   * The focus is the board's scope without its filters: the project's open
   * tickets, inside the parent focus. A plain Search API query rather than
   * another run of the board view, whose facet filters would rewrite the
   * request the columns still read. The index applies the reader's scope.
   *
   * @param \Drupal\bb_core\Entity\BbProjectInterface $project
   *   The board's project.
   * @param list<int>|null $within
   *   The parent focus's tickets, NULL for the whole project.
   * @param list<int>|null $ids
   *   Only these tickets, NULL for no such limit.
   * @param string $search
   *   A search line, in the board search's grammar.
   *
   * @return array{total: int, aggregations: array<string, mixed>}|null
   *   The count, with per-facet counts for the plain focus; NULL when the
   *   search failed.
   */
  public function focus(BbProjectInterface $project, ?array $within, ?array $ids = NULL, string $search = ''): ?array {
    $plain = $ids === NULL && $search === '';
    $ids = $within === NULL ? $ids : array_values(array_intersect($ids ?? $within, $within));
    if ($ids === []) {
      return ['total' => 0, 'aggregations' => []];
    }
    $query = Index::load('bb_tickets')?->query();
    if ($query === NULL) {
      return NULL;
    }
    $query->addCondition('project_id', $project->id());
    $query->addCondition('work_state', BoardAddress::OPEN_WORK_STATES, 'IN');
    if ($ids !== NULL) {
      $query->addCondition('ticket_id', $ids, 'IN');
    }
    if ($search !== '') {
      $this->resolver->apply($query, $this->resolver->resolve($search, $project));
    }
    if ($plain) {
      $query->setOption('search_api_facets', BbBoardSummary::aggregations());
    }
    $query->range(0, 0);
    try {
      $results = $query->execute();
    }
    catch (SearchApiException $e) {
      $this->logger->error('A project board count failed: @message', ['@message' => $e->getMessage()]);
      return NULL;
    }
    return [
      'total' => (int) $results->getResultCount(),
      'aggregations' => $results->getExtraData('search_api_facets', []),
    ];
  }

  /**
   * Tickets the chosen values of one facet match in an unfiltered search.
   *
   * @param list<array{filter: string, count: int}> $rows
   *   The facet's aggregation without any filter.
   * @param list<string> $values
   *   The chosen values; a missing-value token `!(…)` is the `!` row.
   */
  public function alone(array $rows, array $values): int {
    $counts = [];
    foreach ($rows as $row) {
      $counts[trim((string) $row['filter'], '"')] = (int) $row['count'];
    }
    return array_sum(array_map(
      static fn (string $value): int => $counts[str_starts_with($value, '!') ? '!' : $value] ?? 0,
      $values,
    ));
  }

}
