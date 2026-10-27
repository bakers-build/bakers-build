<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Render;

/**
 * Turns a `table` figure into a sortable, paged table description.
 *
 * Every row of the figure is sorted before the page is cut, and the total row
 * covers every row, so neither depends on which page is shown. A ratio or a
 * mean resting on fewer than five tickets is withheld as a faint "—", sorts
 * after every measured row in both directions and gets a footnote.
 */
final class FigureTable {

  /**
   * Rows per page.
   */
  public const PAGE_SIZE = 20;

  /**
   * The Projects table columns.
   *
   * @return array<int, array<string, string>>
   *   Column definitions.
   */
  public static function projectColumns(): array {
    return [
      ['key' => 'label', 'label' => 'Project', 'format' => 'name'],
      ['key' => 'closed', 'label' => 'Closed', 'format' => 'int', 'measurement' => 'closed_tickets'],
      ['key' => 'created', 'label' => 'Created', 'format' => 'int', 'measurement' => 'created_tickets'],
      ['key' => 'open', 'label' => 'Open', 'format' => 'int', 'measurement' => 'open_tickets'],
      ['key' => 'runs', 'label' => 'Runs / ticket', 'format' => 'ratio'],
      ['key' => 'rating', 'label' => 'Rating', 'format' => 'rating'],
      ['key' => 'tokens', 'label' => 'AI tokens', 'format' => 'tokens', 'measurement' => 'run_tokens'],
    ];
  }

  /**
   * The My projects table columns: Projects without created and open.
   *
   * @return array<int, array<string, string>>
   *   Column definitions.
   */
  public static function myProjectColumns(): array {
    return array_values(array_filter(
      self::projectColumns(),
      static fn(array $column): bool => !in_array($column['key'], ['created', 'open'], TRUE),
    ));
  }

  /**
   * The My closed tickets table columns.
   *
   * @return array<int, array<string, string>>
   *   Column definitions.
   */
  public static function ticketColumns(): array {
    return [
      ['key' => 'label', 'label' => 'Ticket', 'format' => 'name'],
      ['key' => 'runs', 'label' => 'Runs', 'format' => 'int', 'measurement' => 'runs'],
      ['key' => 'rating', 'label' => 'Rating', 'format' => 'score'],
      ['key' => 'tokens', 'label' => 'AI tokens', 'format' => 'tokens', 'measurement' => 'run_tokens'],
    ];
  }

  /**
   * The People table columns.
   *
   * @return array<int, array<string, string>>
   *   Column definitions.
   */
  public static function peopleColumns(): array {
    return [
      ['key' => 'label', 'label' => 'Person', 'format' => 'name'],
      ['key' => 'team', 'label' => 'Team', 'format' => 'extra'],
      ['key' => 'closed', 'label' => 'Closed', 'format' => 'int', 'measurement' => 'closed_tickets'],
      ['key' => 'runs', 'label' => 'Runs / ticket', 'format' => 'ratio'],
      ['key' => 'rating', 'label' => 'Rating', 'format' => 'rating'],
      ['key' => 'tokens', 'label' => 'AI tokens', 'format' => 'tokens', 'measurement' => 'run_tokens'],
    ];
  }

  /**
   * Builds the table, its pager and its footnotes.
   *
   * @param array<string, mixed> $figure
   *   One evaluated `table` figure.
   * @param array<int, array<string, string>> $columns
   *   The column definitions.
   * @param array<string, mixed> $query
   *   The request query: `sort[<figure>]`, `order[<figure>]`, `page[<figure>]`.
   * @param string|null $totalLabel
   *   The name of the total row, NULL for none.
   * @param string $noun
   *   What a row is, for the pager (`projects`).
   * @param array<string, array<string, array<string, mixed>>> $cells
   *   Extra cells by row key and column key (a person cell, the team names).
   * @param string $defaultSort
   *   The column sorted by when the query names none.
   * @param string $defaultOrder
   *   The order when the query names none, `asc` or `desc`.
   *
   * @return array{table: array{columns: array<int, array<string, mixed>>, rows: array<int, array<string, mixed>>}, pager: array<string, mixed>|null, footnotes: list<string>}
   *   The `bb_theme:table` props, the pager and the footnotes.
   */
  public static function build(array $figure, array $columns, array $query, ?string $totalLabel, string $noun, array $cells = [], string $defaultSort = 'label', string $defaultOrder = 'asc'): array {
    $id = (string) $figure['id'];
    $values = array_column($figure['measurements'], 'values', 'id');
    $rows = [];
    $footnotes = [];
    foreach ($figure['categories'] as $category) {
      $key = (string) $category['key'];
      $rows[] = self::row($key, (string) $category['label'], $values, $columns, $cells[$key] ?? [], $footnotes);
    }
    $sort = (string) ($query['sort'][$id] ?? $defaultSort);
    $sort = in_array($sort, array_column($columns, 'key'), TRUE) ? $sort : 'label';
    $order = ($query['order'][$id] ?? $defaultOrder) === 'desc' ? 'desc' : 'asc';
    usort($rows, static fn(array $left, array $right): int => self::compare($left, $right, $sort, $order));

    $count = count($rows);
    $pages = max(1, (int) ceil($count / self::PAGE_SIZE));
    $page = min(max(0, (int) ($query['page'][$id] ?? 0)), $pages - 1);
    $shown = array_slice($rows, $page * self::PAGE_SIZE, self::PAGE_SIZE);
    if ($totalLabel !== NULL) {
      $shown[] = self::totalRow($totalLabel, $values, $columns, array_column($figure['categories'], 'key'));
    }
    return [
      'table' => [
        'columns' => self::header($columns, $id, $sort, $order, $query),
        'rows' => array_map(static fn(array $row): array => ['cells' => $row['cells']], $shown),
      ],
      'pager' => $count <= self::PAGE_SIZE ? NULL : [
        'position' => [
          'from' => $page * self::PAGE_SIZE + 1,
          'to' => $page * self::PAGE_SIZE + count(array_slice($rows, $page * self::PAGE_SIZE, self::PAGE_SIZE)),
          'total' => $count,
          'noun' => $noun,
        ],
        'previous' => $page > 0 ? self::url($query, ['page' => [$id => $page - 1]]) : NULL,
        'next' => $page < $pages - 1 ? self::url($query, ['page' => [$id => $page + 1]]) : NULL,
      ],
      'footnotes' => $footnotes,
    ];
  }

  /**
   * One row: its cells and the values it sorts by.
   *
   * @param string $key
   *   The row key.
   * @param string $name
   *   The row name.
   * @param array<string, array<string, int|float|null>> $values
   *   Measurement values keyed by measurement id and row key.
   * @param array<int, array<string, string>> $columns
   *   The column definitions.
   * @param array<string, array<string, mixed>> $extra
   *   Extra cells for this row.
   * @param list<string> $footnotes
   *   The footnotes, appended to in place.
   *
   * @return array{name: string, sort: array<string, int|float|string|null>, cells: array<string, array<string, mixed>>}
   *   The row.
   */
  private static function row(string $key, string $name, array $values, array $columns, array $extra, array &$footnotes): array {
    $value = static fn(string $measurement): int|float|null => $values[$measurement][$key] ?? NULL;
    $sorts = ['label' => $name];
    $cells = ['label' => $extra['label'] ?? ['kind' => 'text', 'value' => $name]];
    foreach ($columns as $column) {
      $col = $column['key'];
      switch ($column['format']) {
        case 'name':
          break;

        case 'extra':
          $cells[$col] = $extra[$col] ?? ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'];
          $sorts[$col] = (string) ($cells[$col]['value'] ?? '');
          break;

        case 'ratio':
          [$cells[$col], $sorts[$col]] = self::sampled(
            (int) ($value('closed_tickets') ?? 0),
            $value('runs'),
            static fn(int $closed, int|float $runs): array => [$runs / $closed, FigureFormat::decimal($runs / $closed)],
            str_replace('%', '%%', $name) . ': %d closed tickets — too few for runs per ticket (n < %d), shown as —',
            $footnotes,
          );
          break;

        case 'rating':
          [$cells[$col], $sorts[$col]] = self::sampled(
            (int) ($value('rated_tickets') ?? 0),
            $value('job_rating'),
            static fn(int $rated, int|float $mean): array => [$mean, FigureFormat::decimal($mean) . ' · n ' . $rated],
            str_replace('%', '%%', $name) . ': %d rated tickets — too few for a rating (n < %d), shown as —',
            $footnotes,
          );
          break;

        case 'score':
          // One ticket's own score: no sample to withhold, only unrated.
          $score = $value('job_rating');
          $sorts[$col] = $score;
          $cells[$col] = $score === NULL
            ? ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint']
            : ['kind' => 'text', 'value' => (string) (int) round($score)];
          break;

        default:
          $number = $value($column['measurement']) ?? 0;
          $sorts[$col] = $number;
          $cells[$col] = $column['format'] === 'tokens'
            ? [
              'kind' => 'text',
              'value' => FigureFormat::abbreviate($number),
              'exact' => FigureFormat::exactTokens($number),
            ]
            : ['kind' => 'text', 'value' => (string) $number];
      }
    }
    return ['name' => $name, 'sort' => $sorts, 'cells' => $cells];
  }

  /**
   * A value resting on a sample, withheld below the minimum.
   *
   * @param int $sample
   *   The tickets the value rests on.
   * @param int|float|null $raw
   *   The value the formatter works from.
   * @param callable(int, int|float): array{0: int|float, 1: string} $format
   *   Returns the sort value and the shown text.
   * @param string $note
   *   The footnote, with placeholders for the sample and the minimum.
   * @param list<string> $footnotes
   *   The footnotes; a sample that exists but is too small adds its note.
   *
   * @return array{0: array<string, string>, 1: int|float|null}
   *   The cell and its sort value; NULL when withheld.
   */
  private static function sampled(int $sample, int|float|null $raw, callable $format, string $note, array &$footnotes): array {
    if ($sample > 0 && $sample < FigureFormat::MIN_SAMPLE) {
      $footnotes[] = sprintf($note, $sample, FigureFormat::MIN_SAMPLE);
    }
    if ($sample < FigureFormat::MIN_SAMPLE || $raw === NULL) {
      return [['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'], NULL];
    }
    [$sort, $text] = $format($sample, $raw);
    return [['kind' => 'text', 'value' => $text], $sort];
  }

  /**
   * Orders two rows; withheld values sort last, ties by name.
   *
   * @param array<string, mixed> $left
   *   One row.
   * @param array<string, mixed> $right
   *   The other row.
   * @param string $sort
   *   The column key sorted by.
   * @param string $order
   *   The order, `asc` or `desc`.
   */
  private static function compare(array $left, array $right, string $sort, string $order): int {
    $a = $left['sort'][$sort] ?? NULL;
    $b = $right['sort'][$sort] ?? NULL;
    if ($a === NULL || $b === NULL) {
      return ($a === NULL) <=> ($b === NULL) ?: strnatcasecmp($left['name'], $right['name']);
    }
    $result = is_string($a) ? strnatcasecmp($a, (string) $b) : $a <=> $b;
    return ($order === 'desc' ? -$result : $result) ?: strnatcasecmp($left['name'], $right['name']);
  }

  /**
   * The total row over every row.
   *
   * @param string $label
   *   The total row's name.
   * @param array<string, array<string, int|float|null>> $values
   *   Measurement values keyed by measurement id and row key.
   * @param array<int, array<string, string>> $columns
   *   The column definitions.
   * @param array<int, string> $keys
   *   Every row key.
   *
   * @return array<string, mixed>
   *   The row.
   */
  private static function totalRow(string $label, array $values, array $columns, array $keys): array {
    $sum = static fn(string $measurement): int|float => array_sum(array_map(static fn(string $key) => $values[$measurement][$key] ?? 0, $keys));
    $weighted = array_sum(array_map(static fn(string $key) => ($values['job_rating'][$key] ?? 0) * ($values['rated_tickets'][$key] ?? 0), $keys));
    $closed = (int) $sum('closed_tickets');
    $rated = (int) $sum('rated_tickets');
    $cells = ['label' => ['kind' => 'text', 'value' => $label, 'emphasis' => 'strong']];
    foreach ($columns as $column) {
      $text = match ($column['format']) {
        'name' => NULL,
        'extra' => '',
        'ratio' => $closed < FigureFormat::MIN_SAMPLE ? '—' : FigureFormat::decimal($sum('runs') / $closed),
        'rating' => $rated < FigureFormat::MIN_SAMPLE ? '—' : FigureFormat::decimal($weighted / $rated) . ' · n ' . $rated,
        'tokens' => FigureFormat::abbreviate($sum((string) $column['measurement'])),
        default => (string) $sum((string) $column['measurement']),
      };
      if ($text !== NULL) {
        $cells[$column['key']] = ['kind' => 'text', 'value' => $text, 'emphasis' => 'strong'];
      }
      if ($column['format'] === 'tokens') {
        $cells[$column['key']]['exact'] = FigureFormat::exactTokens($sum((string) $column['measurement']));
      }
    }
    return ['cells' => $cells];
  }

  /**
   * The header, each sortable column linking to its next order.
   *
   * @param array<int, array<string, string|bool>> $columns
   *   The column definitions.
   * @param string $id
   *   The figure id.
   * @param string $sort
   *   The current sort column.
   * @param string $order
   *   The current order.
   * @param array<string, mixed> $query
   *   The request query.
   *
   * @return array<int, array<string, mixed>>
   *   The `bb_theme:table` columns.
   */
  public static function header(array $columns, string $id, string $sort, string $order, array $query): array {
    $header = [];
    foreach ($columns as $column) {
      $key = (string) $column['key'];
      $current = $key === $sort;
      // A name sorts A–Z first; a figure sorts its largest value first.
      $first = in_array($column['format'], ['name', 'extra'], TRUE) ? 'asc' : 'desc';
      $next = $current ? ($order === 'asc' ? 'desc' : 'asc') : $first;
      // A column marked `sortable: FALSE` gets no sort state and no link.
      $header[] = ['key' => $key, 'label' => $column['label']]
        + (($column['sortable'] ?? TRUE) ? [
          'sort' => $current ? $order : 'none',
          'url' => self::url($query, ['sort' => [$id => $key], 'order' => [$id => $next], 'page' => [$id => 0]]),
        ] : [])
        + ($column['format'] === 'name' ? ['row_header' => TRUE] : []) + (in_array($column['format'], ['name', 'extra'], TRUE) ? [] : ['num' => TRUE]);
    }
    return $header;
  }

  /**
   * A query-only URL keeping every other parameter.
   *
   * @param array<string, mixed> $query
   *   The request query.
   * @param array<string, array<string, int|string>> $changes
   *   The parameters to set.
   */
  public static function url(array $query, array $changes): string {
    foreach ($changes as $name => $set) {
      $query[$name] = array_replace(is_array($query[$name] ?? NULL) ? $query[$name] : [], $set);
    }
    return '?' . http_build_query($query);
  }

}
