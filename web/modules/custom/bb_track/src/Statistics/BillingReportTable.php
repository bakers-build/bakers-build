<?php

declare(strict_types=1);

namespace Drupal\bb_track\Statistics;

use Drupal\bb_core\Statistics\Render\FigureFormat;
use Drupal\bb_core\Statistics\Render\FigureTable;

/**
 * Turns the billing tree into a sortable, paged, expandable table.
 *
 * Siblings are sorted within their parent; the "none" rows (No billing
 * account, Without ticket, Unassigned) sort last either way. Only the top
 * level is paged, and a row shows its children while its key is in
 * `open[]`. The total row covers every top-level row on every page.
 */
final class BillingReportTable {

  /**
   * The figure id the sort, order and page parameters are keyed by.
   */
  public const ID = 'billing';

  /**
   * Node kinds that stand for "none" and sort last.
   */
  private const LAST = ['none', 'no_ticket', 'unassigned'];

  /**
   * Builds the table props and the pager.
   *
   * @param list<array<string, mixed>> $nodes
   *   The top-level nodes of the report.
   * @param string $group
   *   Either `account` or `person`.
   * @param array<string, mixed> $query
   *   The request query.
   *
   * @return array{table: array{columns: array<int, array<string, mixed>>, rows: list<array<string, mixed>>}, pager: array<string, mixed>|null}
   *   The `bb_theme:table` props and the pager.
   */
  public static function build(array $nodes, string $group, array $query): array {
    $sort = (string) ($query['sort'][self::ID] ?? 'label');
    $sort = in_array($sort, ['label', 'hours', 'tokens'], TRUE) ? $sort : 'label';
    $order = ($query['order'][self::ID] ?? 'asc') === 'desc' ? 'desc' : 'asc';
    $open = array_flip(array_map('strval', array_filter((array) ($query['open'] ?? []), 'is_scalar')));
    $nodes = self::sorted($nodes, $sort, $order);

    $count = count($nodes);
    $pages = max(1, (int) ceil($count / FigureTable::PAGE_SIZE));
    $page = min(max(0, (int) ($query['page'][self::ID] ?? 0)), $pages - 1);
    $shown = array_slice($nodes, $page * FigureTable::PAGE_SIZE, FigureTable::PAGE_SIZE);
    $rows = [];
    foreach ($shown as $node) {
      self::rows($node, 0, $open, $query, $rows);
    }
    $rows[] = self::totalRow($nodes);
    return [
      'table' => [
        'columns' => FigureTable::header(self::columns($group), self::ID, $sort, $order, $query),
        'rows' => $rows,
      ],
      'pager' => $count <= FigureTable::PAGE_SIZE ? NULL : [
        'position' => [
          'from' => $page * FigureTable::PAGE_SIZE + 1,
          'to' => $page * FigureTable::PAGE_SIZE + count($shown),
          'total' => $count,
          'noun' => $group === 'person' ? 'people' : 'accounts',
        ],
        'previous' => $page > 0 ? FigureTable::url($query, ['page' => [self::ID => $page - 1]]) : NULL,
        'next' => $page < $pages - 1 ? FigureTable::url($query, ['page' => [self::ID => $page + 1]]) : NULL,
      ],
    ];
  }

  /**
   * The column definitions.
   *
   * @return list<array<string, string|bool>>
   *   Columns in the FigureTable format.
   */
  private static function columns(string $group): array {
    return [
      [
        'key' => 'label',
        'label' => $group === 'person' ? 'Person / account / project / ticket' : 'Account / project / ticket',
        'format' => 'name',
      ],
      ['key' => 'external_id', 'label' => 'External ID', 'format' => 'extra', 'sortable' => FALSE],
      ['key' => 'tickets', 'label' => 'Tickets', 'format' => 'int', 'sortable' => FALSE],
      ['key' => 'people', 'label' => 'People', 'format' => 'int', 'sortable' => FALSE],
      ['key' => 'hours', 'label' => 'Hours', 'format' => 'int'],
      ['key' => 'tokens', 'label' => 'AI tokens', 'format' => 'int'],
    ];
  }

  /**
   * The nodes and their descendants, each level sorted.
   *
   * @param list<array<string, mixed>> $nodes
   *   Sibling nodes.
   * @param string $sort
   *   One of `label`, `hours` or `tokens`.
   * @param string $order
   *   Either `asc` or `desc`.
   *
   * @return list<array<string, mixed>>
   *   The sorted nodes.
   */
  private static function sorted(array $nodes, string $sort, string $order): array {
    usort($nodes, static function (array $left, array $right) use ($sort, $order): int {
      $last = in_array($left['kind'], self::LAST, TRUE) <=> in_array($right['kind'], self::LAST, TRUE);
      if ($last !== 0) {
        return $last;
      }
      $result = $sort === 'label' ? strnatcasecmp($left['label'], $right['label']) : $left[$sort] <=> $right[$sort];
      return ($order === 'desc' ? -$result : $result) ?: strnatcasecmp($left['label'], $right['label']);
    });
    return array_map(static fn(array $node): array => ['children' => self::sorted($node['children'], $sort, $order)] + $node, $nodes);
  }

  /**
   * Appends a node's row and, when it is open, its descendants' rows.
   *
   * @param array<string, mixed> $node
   *   The node.
   * @param int $depth
   *   Its level, 0 for the top.
   * @param array<string, int> $open
   *   The open keys.
   * @param array<string, mixed> $query
   *   The request query.
   * @param list<array<string, mixed>> $rows
   *   The rows, appended to in place.
   */
  private static function rows(array $node, int $depth, array $open, array $query, array &$rows): void {
    $expanded = isset($open[$node['key']]);
    $row = ['depth' => $depth, 'cells' => self::cells($node)];
    if ($node['children'] !== []) {
      $row['disclosure'] = ['href' => self::toggle($query, $node['key']), 'expanded' => $expanded];
    }
    $badges = self::badges($node);
    if ($badges !== []) {
      $row['badges'] = $badges;
    }
    $rows[] = $row;
    if ($expanded) {
      foreach ($node['children'] as $child) {
        self::rows($child, $depth + 1, $open, $query, $rows);
      }
    }
  }

  /**
   * One node's cells.
   *
   * @param array<string, mixed> $node
   *   The node.
   *
   * @return array<string, array<string, string>>
   *   Cells by column key.
   */
  private static function cells(array $node): array {
    $dash = ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'];
    $leaf = in_array($node['kind'], ['ticket', 'no_ticket'], TRUE);
    $people = in_array($node['kind'], ['person', 'unassigned'], TRUE)
      ? $dash
      : ['kind' => 'text', 'value' => self::people($node['people'])];
    if ($leaf) {
      $initials = array_filter($node['people']);
      $people = $initials === [] ? $dash : ['kind' => 'text', 'value' => implode(', ', $initials)];
    }
    return [
      'label' => ['kind' => 'text', 'value' => $node['label']],
      'external_id' => (string) $node['external_id'] === ''
        ? $dash
        : ['kind' => 'mono', 'value' => (string) $node['external_id']],
      'tickets' => $leaf ? $dash : ['kind' => 'text', 'value' => (string) count($node['tickets'])],
      'people' => $people,
      'hours' => self::hoursCell($node['hours']),
      'tokens' => self::tokensCell($node['tokens']),
    ];
  }

  /**
   * The badges beside a row's name.
   *
   * @param array<string, mixed> $node
   *   The node.
   *
   * @return list<array<string, string>>
   *   Badges with label and tone.
   */
  private static function badges(array $node): array {
    if ($node['kind'] === 'none') {
      return [['label' => 'tokens only', 'tone' => 'neutral']];
    }
    if ($node['kind'] !== 'account') {
      return [];
    }
    $badges = [];
    if ($node['default']) {
      $badges[] = ['label' => 'default account', 'tone' => 'neutral'];
    }
    if ((string) $node['external_id'] === '') {
      $badges[] = ['label' => 'no external ID', 'tone' => 'attention'];
    }
    return $badges;
  }

  /**
   * The total row over every top-level node.
   *
   * @param list<array<string, mixed>> $nodes
   *   The top-level nodes.
   *
   * @return array<string, mixed>
   *   The row.
   */
  private static function totalRow(array $nodes): array {
    $tickets = array_replace([], ...array_column($nodes, 'tickets'));
    $people = array_replace([], ...array_column($nodes, 'people'));
    $strong = static fn(array $cell): array => ['emphasis' => 'strong'] + $cell;
    return [
      'depth' => 0,
      'cells' => [
        'label' => ['kind' => 'text', 'value' => 'Total', 'emphasis' => 'strong'],
        'external_id' => ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'],
        'tickets' => ['kind' => 'text', 'value' => (string) count($tickets), 'emphasis' => 'strong'],
        'people' => ['kind' => 'text', 'value' => self::people($people), 'emphasis' => 'strong'],
        'hours' => $strong(self::hoursCell(array_sum(array_column($nodes, 'hours')))),
        'tokens' => $strong(self::tokensCell(array_sum(array_column($nodes, 'tokens')))),
      ],
    ];
  }

  /**
   * The count of a set of people, as "N people".
   *
   * @param array<int, string> $people
   *   Initials by user id.
   */
  private static function people(array $people): string {
    return count($people) === 1 ? '1 person' : count($people) . ' people';
  }

  /**
   * A cell of hours, with the exact value on hover.
   *
   * @return array<string, string>
   *   The cell.
   */
  private static function hoursCell(int $seconds): array {
    if ($seconds === 0) {
      return ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'];
    }
    return [
      'kind' => 'text',
      'value' => self::hours($seconds),
      'exact' => number_format($seconds / 3600, 2) . ' h — Recorded and approved worklogs by work date',
    ];
  }

  /**
   * A cell of tokens, abbreviated, with the exact value on hover.
   *
   * @return array<string, string>
   *   The cell.
   */
  private static function tokensCell(int $tokens): array {
    if ($tokens === 0) {
      return ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'];
    }
    return [
      'kind' => 'text',
      'value' => FigureFormat::abbreviate($tokens),
      'exact' => FigureFormat::exactTokens($tokens),
    ];
  }

  /**
   * Hours: one decimal under 100 h, whole hours with separators above.
   *
   * 52200 seconds read "14.5 h", 6271200 read "1,742 h", none reads "—".
   */
  public static function hours(int $seconds): string {
    if ($seconds === 0) {
      return '—';
    }
    $hours = $seconds / 3600;
    return number_format($hours, $hours < 100 ? 1 : 0) . ' h';
  }

  /**
   * The current query with one row key added to or removed from `open[]`.
   *
   * @param array<string, mixed> $query
   *   The request query.
   * @param string $key
   *   The row key.
   */
  private static function toggle(array $query, string $key): string {
    $open = array_values(array_filter((array) ($query['open'] ?? []), 'is_scalar'));
    $open = in_array($key, $open, TRUE) ? array_values(array_diff($open, [$key])) : [...$open, $key];
    unset($query['open']);
    if ($open !== []) {
      $query['open'] = $open;
    }
    return '?' . http_build_query($query);
  }

}
