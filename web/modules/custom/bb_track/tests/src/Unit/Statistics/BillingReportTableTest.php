<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Unit\Statistics;

use Drupal\Tests\UnitTestCase;
use Drupal\bb_track\Statistics\BillingReportTable;
use PHPUnit\Framework\Attributes\Group;

/**
 * Sorting, paging, expansion and cells of the billing report table.
 */
#[Group('bb_track')]
final class BillingReportTableTest extends UnitTestCase {

  /**
   * Names sort A–Z regardless of case; "none" rows come last.
   */
  public function testInitialOrderIsAlphabeticalWithSpecialRowsLast(): void {
    $nodes = [
      $this->node('n', 'none', 'No billing account', 0, 5),
      $this->node('a2', 'account', 'b', 1),
      $this->node('a1', 'account', 'A', 1),
    ];
    self::assertSame(['A', 'b', 'No billing account', 'Total'], $this->labels(BillingReportTable::build($nodes, 'account', [])));
  }

  /**
   * Sorting by hours descending orders siblings inside their parent.
   */
  public function testSortByHoursDescSortsSiblingsWithinParent(): void {
    $nodes = [
      $this->node('a1', 'account', 'Alpha', 10, 0, [
        $this->node('p1-1', 'project', 'Small', 2),
        $this->node('p1-2', 'project', 'Big', 8),
      ]),
      $this->node('a2', 'account', 'Beta', 30),
    ];
    $query = ['sort' => ['billing' => 'hours'], 'order' => ['billing' => 'desc'], 'open' => ['a1']];
    $build = BillingReportTable::build($nodes, 'account', $query);
    self::assertSame(['Beta', 'Alpha', 'Big', 'Small', 'Total'], $this->labels($build));
    $hours = array_column($build['table']['columns'], 'sort', 'key');
    self::assertSame(['label' => 'none', 'hours' => 'desc', 'tokens' => 'none'], $hours);
  }

  /**
   * Only rows whose key is open show their children; unknown keys are inert.
   */
  public function testOnlyOpenRowsShowChildren(): void {
    $nodes = [
      $this->node('a1', 'account', 'Alpha', 1, 0, [
        $this->node('p1-1', 'project', 'Project', 1, 0, [
          $this->node('t1', 'ticket', 'T-1 · Ticket', 1),
        ]),
      ]),
    ];
    $build = BillingReportTable::build($nodes, 'account', ['open' => ['a1', 'zz', ['x']]]);
    self::assertSame(['Alpha', 'Project', 'Total'], $this->labels($build));
    $rows = $build['table']['rows'];
    self::assertSame([0, 1], [$rows[0]['depth'], $rows[1]['depth']]);
    self::assertTrue($rows[0]['disclosure']['expanded']);
    self::assertFalse($rows[1]['disclosure']['expanded']);
    // Collapsing drops the key; expanding adds it.
    self::assertSame('?open%5B0%5D=zz', $rows[0]['disclosure']['href']);
    self::assertSame('?open%5B0%5D=a1&open%5B1%5D=zz&open%5B2%5D=p1-1', $rows[1]['disclosure']['href']);
  }

  /**
   * The top level pages at the page size; the total covers every page.
   */
  public function testTopLevelPagesAtPageSize(): void {
    $nodes = [];
    for ($i = 1; $i <= 21; $i++) {
      $nodes[] = $this->node('a' . $i, 'account', sprintf('Account %02d', $i), 1);
    }
    $first = BillingReportTable::build($nodes, 'account', []);
    self::assertCount(21, $first['table']['rows']);
    self::assertSame(['from' => 1, 'to' => 20, 'total' => 21, 'noun' => 'accounts'], $first['pager']['position']);
    self::assertNull($first['pager']['previous']);
    self::assertSame('?page%5Bbilling%5D=1', $first['pager']['next']);
    self::assertSame('5.8 h', end($first['table']['rows'])['cells']['hours']['value']);
    $second = BillingReportTable::build($nodes, 'account', ['page' => ['billing' => 1]]);
    self::assertSame(['Account 21', 'Total'], $this->labels($second));
  }

  /**
   * Hours read with one decimal below 100 h, whole hours from there.
   */
  public function testHoursFormat(): void {
    self::assertSame('14.5 h', BillingReportTable::hours(52200));
    self::assertSame('9.0 h', BillingReportTable::hours(32400));
    self::assertSame('1,742 h', BillingReportTable::hours(6271200));
    self::assertSame('—', BillingReportTable::hours(0));
  }

  /**
   * Each kind of row fills the columns it has a value for.
   */
  public function testCellsPerKind(): void {
    $ticket = $this->node('t1', 'ticket', 'T-1 · Ticket', 1, 10);
    $ticket['tickets'] = [1 => TRUE];
    $ticket['people'] = [7 => 'AB', 8 => 'CD'];
    $project = $this->node('p1-1', 'project', 'Project', 1, 10, [$ticket]);
    $project['tickets'] = [1 => TRUE];
    $project['people'] = [7 => 'AB', 8 => 'CD'];
    $account = [
      'external_id' => 'K-100',
      'default' => TRUE,
      'tickets' => [1 => TRUE],
      'people' => [7 => 'AB', 8 => 'CD'],
    ]
      + $this->node('a1', 'account', 'Billed', 1, 10, [$project]);
    $bare = $this->node('a2', 'account', 'Bare', 1);
    $none = $this->node('n', 'none', 'No billing account', 0, 5);
    $build = BillingReportTable::build([$account, $bare, $none], 'account', ['open' => ['a1', 'p1-1']]);
    $rows = array_column(array_map(static fn(array $row): array => ['name' => $row['cells']['label']['value']] + $row, $build['table']['rows']), NULL, 'name');

    $external = $rows['Billed']['cells']['external_id'];
    self::assertSame(['mono', 'K-100'], [$external['kind'], $external['value']]);
    self::assertSame('—', $rows['Bare']['cells']['external_id']['value']);
    self::assertSame('1', $rows['Billed']['cells']['tickets']['value']);
    self::assertSame('2 people', $rows['Billed']['cells']['people']['value']);
    self::assertSame('—', $rows['T-1 · Ticket']['cells']['tickets']['value']);
    self::assertSame('AB, CD', $rows['T-1 · Ticket']['cells']['people']['value']);
    self::assertSame([['label' => 'default account', 'tone' => 'neutral']], $rows['Billed']['badges']);
    self::assertSame([['label' => 'no external ID', 'tone' => 'attention']], $rows['Bare']['badges']);
    self::assertSame([['label' => 'tokens only', 'tone' => 'neutral']], $rows['No billing account']['badges']);
    self::assertArrayNotHasKey('badges', $rows['Project']);
    self::assertSame('—', $rows['No billing account']['cells']['hours']['value']);
    self::assertSame('5', $rows['No billing account']['cells']['tokens']['value']);
    $sortable = array_map(static fn(array $column): bool => isset($column['url']), array_column($build['table']['columns'], NULL, 'key'));
    self::assertSame(['label', 'hours', 'tokens'], array_keys(array_filter($sortable)));
  }

  /**
   * Grouped by person, the first column names the deeper levels.
   */
  public function testPersonGroupingNamesTheFirstColumn(): void {
    $build = BillingReportTable::build([$this->node('u1', 'person', 'Ada', 1)], 'person', []);
    self::assertSame('Person / account / project / ticket', $build['table']['columns'][0]['label']);
    self::assertSame('—', $build['table']['rows'][0]['cells']['people']['value']);
  }

  /**
   * A report node.
   *
   * @param string $key
   *   The key.
   * @param string $kind
   *   The kind.
   * @param string $label
   *   The name.
   * @param int $hours
   *   Whole hours.
   * @param int $tokens
   *   Tokens.
   * @param list<array<string, mixed>> $children
   *   Children.
   *
   * @return array<string, mixed>
   *   The node.
   */
  private function node(string $key, string $kind, string $label, int $hours, int $tokens = 0, array $children = []): array {
    return [
      'key' => $key,
      'kind' => $kind,
      'label' => $label,
      'entity' => NULL,
      'hours' => $hours * 1000,
      'approved' => 0,
      'recorded' => $hours * 1000,
      'tokens' => $tokens,
      'external_id' => NULL,
      'default' => FALSE,
      'tickets' => [],
      'people' => [],
      'children' => $children,
    ];
  }

  /**
   * The names of the rows, in order.
   *
   * @param array<string, mixed> $build
   *   The table build.
   *
   * @return list<string>
   *   Names.
   */
  private function labels(array $build): array {
    return array_values(array_map(static fn(array $row): string => $row['cells']['label']['value'], $build['table']['rows']));
  }

}
