<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit\Statistics;

use Drupal\bb_core\Statistics\Render\FigureTable;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers sorting, paging, totals and small samples of the Insights tables.
 */
#[Group('bb_core')]
final class FigureTableTest extends UnitTestCase {

  /**
   * Rows come in name order unless a column is chosen.
   */
  public function testDefaultOrderIsByNameAscending(): void {
    $table = $this->build($this->figure(['zulu' => 9, 'alpha' => 1, 'mike' => 5]), []);
    self::assertSame(['alpha', 'mike', 'zulu', 'All projects'], $this->names($table));
    self::assertSame('asc', $this->column($table, 'label')['sort']);
    self::assertSame('none', $this->column($table, 'closed')['sort']);
  }

  /**
   * A column sort orders every row before the page is cut.
   */
  public function testColumnSortCoversAllRowsBeforePaging(): void {
    $closed = [];
    for ($i = 1; $i <= 25; $i++) {
      $closed[sprintf('p%02d', $i)] = $i === 23 ? 100 : $i;
    }
    $table = $this->build($this->figure($closed), [
      'sort' => ['workspace_projects' => 'closed'],
      'order' => ['workspace_projects' => 'desc'],
    ]);
    self::assertSame('p23', $this->names($table)[0]);
    self::assertCount(21, $this->rows($table), 'Twenty rows plus the total row.');
    self::assertSame('desc', $this->column($table, 'closed')['sort']);
  }

  /**
   * Twenty rows need no pager; twenty-one put one row on page two.
   */
  public function testPagerBoundaries(): void {
    $twenty = [];
    for ($i = 1; $i <= 20; $i++) {
      $twenty[sprintf('p%02d', $i)] = $i;
    }
    self::assertNull($this->build($this->figure($twenty), [])['pager']);

    $twentyOne = $twenty + ['p21' => 21];
    $first = $this->build($this->figure($twentyOne), [])['pager'];
    self::assertSame(['from' => 1, 'to' => 20, 'total' => 21, 'noun' => 'projects'], $first['position']);
    self::assertNull($first['previous']);
    self::assertNotNull($first['next']);

    $second = $this->build($this->figure($twentyOne), ['page' => ['workspace_projects' => '1']]);
    self::assertSame(['from' => 21, 'to' => 21, 'total' => 21, 'noun' => 'projects'], $second['pager']['position']);
    self::assertNotNull($second['pager']['previous']);
    self::assertNull($second['pager']['next']);
    self::assertSame(['p21', 'All projects'], $this->names($second));
  }

  /**
   * The total row covers every row, not only the visible page.
   */
  public function testTotalRowCoversAllRows(): void {
    $closed = [];
    for ($i = 1; $i <= 21; $i++) {
      $closed[sprintf('p%02d', $i)] = 10;
    }
    $table = $this->build($this->figure($closed, runs: 30), ['page' => ['workspace_projects' => '1']]);
    $total = $this->rows($table)[1]['cells'];
    self::assertSame('All projects', $total['label']['value']);
    self::assertSame('210', $total['closed']['value']);
    self::assertSame('3.0', $total['runs']['value'], 'Runs per ticket of the total is all runs over all closed tickets.');
    self::assertSame('strong', $total['closed']['emphasis']);
  }

  /**
   * Abbreviated token cells and the total carry their exact value.
   */
  public function testTokenCellsCarryExactValue(): void {
    $rows = $this->rows($this->build($this->figure(['atlas' => 12, 'pfiff' => 3]), []));
    self::assertSame('1.5 B', $rows[0]['cells']['tokens']['value']);
    self::assertSame('1,500,000,000 tokens — Sum of run tokens by run start, UTC', $rows[0]['cells']['tokens']['exact']);
    self::assertSame('3.0 B', $rows[2]['cells']['tokens']['value']);
    self::assertSame('3,000,000,000 tokens — Sum of run tokens by run start, UTC', $rows[2]['cells']['tokens']['exact']);
    self::assertArrayNotHasKey('exact', $rows[0]['cells']['closed'], 'Unabbreviated counts need no disclosure.');
  }

  /**
   * Too few closed or rated tickets show a faint dash and a footnote, never 0.
   */
  public function testSmallSampleShowsDashAndFootnote(): void {
    $figure = $this->figure(['atlas' => 12, 'pfiff' => 3], runs: 20, rated: ['atlas' => 2, 'pfiff' => 3]);
    $table = $this->build($figure, []);
    $byName = [];
    foreach ($this->rows($table) as $row) {
      $byName[$row['cells']['label']['value']] = $row['cells'];
    }
    self::assertSame('—', $byName['pfiff']['runs']['value']);
    self::assertSame('faint', $byName['pfiff']['runs']['emphasis']);
    self::assertSame('1.7', $byName['atlas']['runs']['value']);
    self::assertSame('—', $byName['atlas']['rating']['value'], 'Two rated tickets are too few for a rating.');
    self::assertSame('—', $byName['pfiff']['rating']['value']);
    self::assertContains('pfiff: 3 closed tickets — too few for runs per ticket (n < 5), shown as —', $table['footnotes']);
    self::assertContains('atlas: 2 rated tickets — too few for a rating (n < 5), shown as —', $table['footnotes']);
    self::assertNotContains('0', [$byName['pfiff']['runs']['value'], $byName['pfiff']['rating']['value']]);
  }

  /**
   * A row without any closed or rated ticket is a dash without a footnote.
   */
  public function testEmptyRowsGetNoFootnote(): void {
    $table = $this->build($this->figure(['idle' => 0, 'busy' => 12], rated: ['idle' => 0, 'busy' => 0]), []);
    self::assertSame([], $table['footnotes']);
    self::assertSame('—', $this->rows($table)[1]['cells']['runs']['value']);
  }

  /**
   * Rows withheld as a small sample sort after every measured row, both ways.
   */
  public function testSmallSampleRowsSortLast(): void {
    $figure = $this->figure(['big' => 10, 'small' => 2, 'mid' => 6], runs: 30);
    foreach (['asc', 'desc'] as $order) {
      $table = $this->build($figure, [
        'sort' => ['workspace_projects' => 'runs'],
        'order' => ['workspace_projects' => $order],
      ]);
      $names = $this->names($table);
      self::assertSame('small', $names[2], "A withheld row is last when sorting $order.");
    }
  }

  /**
   * Ratings render as the mean with its sample size.
   */
  public function testRatingShowsMeanAndSampleSize(): void {
    $table = $this->build($this->figure(['atlas' => 12], rated: ['atlas' => 6], rating: ['atlas' => 4.25]), []);
    self::assertSame('4.3 · n 6', $this->rows($table)[0]['cells']['rating']['value']);
  }

  /**
   * My closed tickets lead with the ticket that used the most AI tokens.
   */
  public function testTicketColumnsDefaultToTokensDescending(): void {
    $table = FigureTable::build($this->tickets([
      'small' => [50000000, 4.0],
      'large' => [900000000, 5.0],
      'middle' => [410000000, NULL],
    ]), FigureTable::ticketColumns(), [], NULL, 'tickets', [], 'tokens', 'desc');
    self::assertSame(['large', 'middle', 'small'], $this->names($table));
    self::assertSame(['900 M', '410 M', '50.0 M'], array_map(static fn(array $row): string => $row['cells']['tokens']['value'], $this->rows($table)));
    self::assertSame('desc', $this->column($table, 'tokens')['sort']);
  }

  /**
   * An unrated ticket shows a faint dash; a rated one its own score.
   */
  public function testUnratedTicketShowsDash(): void {
    $table = FigureTable::build($this->tickets([
      'rated' => [10, 4.0],
      'unrated' => [10, NULL],
    ]), FigureTable::ticketColumns(), [], NULL, 'tickets');
    $rating = [];
    foreach ($this->rows($table) as $row) {
      $rating[$row['cells']['label']['value']] = $row['cells']['rating'];
    }
    self::assertSame(['kind' => 'text', 'value' => '4'], $rating['rated']);
    self::assertSame(['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'], $rating['unrated']);
    self::assertSame([], $table['footnotes']);
  }

  /**
   * My projects leave out the created and open columns.
   */
  public function testMyProjectColumnsLeaveOutCreatedAndOpen(): void {
    self::assertSame(['label', 'closed', 'runs', 'rating', 'tokens'], array_column(FigureTable::myProjectColumns(), 'key'));
  }

  /**
   * A user_tickets-shaped payload.
   *
   * @param array<string, array{0: int, 1: float|null}> $tickets
   *   Run tokens and rating keyed by ticket name.
   *
   * @return array<string, mixed>
   *   The payload.
   */
  private function tickets(array $tickets): array {
    $categories = [];
    $values = array_fill_keys(['closed_tickets', 'runs', 'job_rating', 'run_tokens'], []);
    foreach ($tickets as $name => [$tokens, $rating]) {
      $categories[] = ['key' => $name, 'label' => $name];
      $values['closed_tickets'][$name] = 1;
      $values['runs'][$name] = 2;
      $values['job_rating'][$name] = $rating;
      $values['run_tokens'][$name] = $tokens;
    }
    $measurements = [];
    foreach ($values as $id => $byKey) {
      $measurements[] = ['id' => $id, 'label' => $id, 'values' => $byKey];
    }
    return ['id' => 'user_tickets', 'categories' => $categories, 'measurements' => $measurements];
  }

  /**
   * Builds the Projects table of a synthetic figure.
   *
   * @param array<string, mixed> $figure
   *   The figure payload.
   * @param array<string, mixed> $query
   *   The request query.
   *
   * @return array<string, mixed>
   *   The table description.
   */
  private function build(array $figure, array $query): array {
    return FigureTable::build($figure, FigureTable::projectColumns(), $query, 'All projects', 'projects');
  }

  /**
   * A workspace_projects-shaped payload.
   *
   * @param array<string, int> $closed
   *   Closed tickets keyed by project name.
   * @param int $runs
   *   Runs per project.
   * @param array<string, int> $rated
   *   Rated tickets keyed by project name; default five each.
   * @param array<string, float> $rating
   *   Mean ratings keyed by project name; default 4.0.
   *
   * @return array<string, mixed>
   *   The payload.
   */
  private function figure(array $closed, int $runs = 10, array $rated = [], array $rating = []): array {
    $categories = [];
    $values = array_fill_keys([
      'closed_tickets', 'created_tickets', 'open_tickets', 'runs',
      'runs_per_ticket', 'job_rating', 'rated_tickets', 'run_tokens',
    ], []);
    foreach ($closed as $name => $count) {
      $categories[] = ['key' => $name, 'label' => $name];
      $values['closed_tickets'][$name] = $count;
      $values['created_tickets'][$name] = $count + 1;
      $values['open_tickets'][$name] = 1;
      $values['runs'][$name] = $runs;
      $values['runs_per_ticket'][$name] = $count === 0 ? NULL : round($runs / $count, 2);
      $values['rated_tickets'][$name] = $rated[$name] ?? 5;
      $values['job_rating'][$name] = $rating[$name] ?? 4.0;
      $values['run_tokens'][$name] = 1500000000;
    }
    $measurements = [];
    foreach ($values as $id => $byKey) {
      $measurements[] = ['id' => $id, 'label' => $id, 'values' => $byKey];
    }
    return ['id' => 'workspace_projects', 'categories' => $categories, 'measurements' => $measurements];
  }

  /**
   * The table's rows.
   *
   * @return array<int, array<string, mixed>>
   *   The rows.
   */
  private function rows(array $table): array {
    return $table['table']['rows'];
  }

  /**
   * The first-column names of the table's rows.
   *
   * @return array<int, string>
   *   The names.
   */
  private function names(array $table): array {
    return array_map(static fn(array $row): string => $row['cells']['label']['value'], $this->rows($table));
  }

  /**
   * One column of the table header.
   *
   * @return array<string, mixed>
   *   The column.
   */
  private function column(array $table, string $key): array {
    return array_column($table['table']['columns'], NULL, 'key')[$key];
  }

}
