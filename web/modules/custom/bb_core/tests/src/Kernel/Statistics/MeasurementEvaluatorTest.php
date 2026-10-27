<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementResult;
use Drupal\Core\Config\FileStorage;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers reusable measurement evaluation across category shapes and contexts.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MeasurementEvaluatorTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  private const NOW = 1789920000;
  private const HOUR = 3600;
  private const DAY = 86400;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_comment',
      'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    $this->createAccount('uid1-dummy');
    $this->installMeasurements();
  }

  /**
   * Ticket and run measurements share exact trailing-window categories.
   */
  public function testWindowsCountClosedTicketsAndRuns(): void {
    $project = $this->createProject('windows');
    $user = $this->createAccount('alice-windows');
    $recent = $this->createTicket($project, $user, self::NOW - self::HOUR);
    $this->createRun($recent, self::NOW - self::HOUR);
    $this->createTicket($project, $user, self::NOW - 3 * self::DAY);
    $this->createTicket($project, $user, self::NOW - 40 * self::DAY);
    $this->createOpenTicket($project, $user, self::NOW - self::HOUR);

    $categories = ['type' => 'windows', 'values' => ['day', 'week', 'month']];
    $contexts = ['project' => $project];
    self::assertSame(
      ['day' => 1, 'week' => 2, 'month' => 2],
      $this->evaluate('closed_tickets', $contexts, $categories)->getValues(),
    );
    self::assertSame(
      ['day' => 1, 'week' => 1, 'month' => 1],
      $this->evaluate('runs', $contexts, $categories)->getValues(),
    );
    self::assertSame(
      ['day' => 1.0, 'week' => 2.0, 'month' => 2.0],
      $this->evaluate('tickets_per_run', $contexts, $categories)->getValues(),
    );
  }

  /**
   * New tickets are bucketed by creation, whether closed, open or unassigned.
   */
  public function testCreatedTicketsCountsByCreatedRegardlessOfClosed(): void {
    $this->installShippedMeasurement('created_tickets');
    $project = $this->createProject('created');
    $user = $this->createAccount('alice-created');
    $day = self::NOW - 2 * self::DAY;
    $this->createTicketAt($project, $user, $day, $day + self::DAY);
    $this->createTicketAt($project, $user, $day, NULL);
    $this->createTicketAt($project, NULL, $day, $day);
    $this->createTicketAt($project, $user, $day - self::DAY, NULL);

    $values = $this->evaluate('created_tickets', ['project' => $project], [
      'type' => 'days',
      ...self::lastDays(7),
    ])->getValues();

    self::assertSame(3, $values[gmdate('Y-m-d', $day)]);
    self::assertSame(1, $values[gmdate('Y-m-d', $day - self::DAY)]);
    self::assertSame(0, $values[gmdate('Y-m-d', $day + self::DAY)]);
  }

  /**
   * Open tickets are counted at each section end; the running day at now.
   */
  public function testOpenTicketsAtSectionEnd(): void {
    $this->installShippedMeasurement('open_tickets');
    $project = $this->createProject('open');
    $user = $this->createAccount('alice-open');
    $today = self::NOW - self::NOW % self::DAY;
    $day = $today - 2 * self::DAY;
    $endOfDay = $day + self::DAY - 1;
    $this->createTicketAt($project, $user, $day - 2 * self::DAY, NULL);
    // Closed exactly at the section end: closed, not open, at that end.
    $this->createTicketAt($project, $user, $day - self::DAY, $endOfDay);
    $this->createTicketAt($project, NULL, $day - self::DAY, $day + self::DAY);
    $this->createTicketAt($project, $user, $day + self::DAY, NULL);
    // Created later today, after the evaluation time.
    $this->createTicketAt($project, $user, self::NOW + self::HOUR, NULL);

    $values = $this->evaluate('open_tickets', ['project' => $project], [
      'type' => 'days',
      ...self::lastDays(7),
    ])->getValues();

    self::assertSame(3, $values[gmdate('Y-m-d', $day - self::DAY)]);
    self::assertSame(2, $values[gmdate('Y-m-d', $day)]);
    self::assertSame(2, $values[gmdate('Y-m-d', $today)]);
  }

  /**
   * Daily categories are oldest first and include explicit zeroes.
   */
  public function testDailyCategoriesCoverTheSelectedPeriod(): void {
    $project = $this->createProject('days');
    $user = $this->createAccount('alice-days');
    $this->createTicket($project, $user, self::NOW - self::HOUR);
    $this->createTicket($project, $user, self::NOW - 2 * self::DAY);

    $result = $this->evaluate('closed_tickets', ['project' => $project], [
      'type' => 'days',
      ...self::lastDays(7),
    ]);

    self::assertCount(7, $result->getCategories());
    self::assertSame('2026-09-14', $result->getCategories()[0]['key']);
    self::assertSame('2026-09-20', $result->getCategories()[6]['key']);
    self::assertSame(1, $result->getValues()['2026-09-20']);
    self::assertSame(1, $result->getValues()['2026-09-18']);
    self::assertSame(0, $result->getValues()['2026-09-19']);
  }

  /**
   * Entity dimensions carry stable UUID keys and server-owned labels.
   */
  public function testProjectAndUserDimensionsAreLabelled(): void {
    $workspace = $this->createWorkspace('dimensions');
    $team = $this->createTeam('dimensions', $workspace);
    $alpha = $this->createProject('alpha', $workspace, [$team]);
    $beta = $this->createProject('beta', $workspace, [$team]);
    $alice = $this->createAccount('alice-dimensions');
    $bob = $this->createAccount('bob-dimensions');
    $this->createTicket($alpha, $alice, self::NOW - self::HOUR);
    $this->createTicket($alpha, $bob, self::NOW - self::HOUR);
    $this->createTicket($beta, $alice, self::NOW - self::HOUR);

    $projects = $this->evaluate('closed_tickets', ['team' => $team], [
      'type' => 'dimension',
      'dimension' => 'project',
      ...self::lastDays(30),
    ]);
    self::assertSame(['alpha', 'beta'], array_column($projects->getCategories(), 'label'));
    self::assertSame(2, $projects->getValues()[$alpha->uuid()]);
    self::assertSame(1, $projects->getValues()[$beta->uuid()]);

    $users = $this->evaluate('closed_tickets', ['team' => $team], [
      'type' => 'dimension',
      'dimension' => 'user',
      ...self::lastDays(30),
    ]);
    self::assertSame(2, $users->getValues()[$alice->uuid()]);
    self::assertSame(1, $users->getValues()[$bob->uuid()]);
  }

  /**
   * Dimension rows are ranked by value descending, ties broken by label.
   *
   * The alphabetical order and the by-count order deliberately disagree, so an
   * assertion on the row order can only pass on the ranking. `alpha` and
   * `bravo` tie at one ticket and pin the tie-break, which is the only thing
   * keeping equal rows in a stable, readable order.
   */
  public function testDimensionRowsAreRankedByValueWithLabelTieBreak(): void {
    $workspace = $this->createWorkspace('ranked');
    $team = $this->createTeam('ranked', $workspace);
    $projects = [];
    foreach (['zulu' => 3, 'mike' => 2, 'alpha' => 1, 'bravo' => 1] as $name => $count) {
      $projects[$name] = $this->createProject($name, $workspace, [$team]);
      $author = $this->createAccount('author-' . $name);
      for ($i = 0; $i < $count; $i++) {
        $this->createTicket($projects[$name], $author, self::NOW - self::HOUR);
      }
    }

    $result = $this->evaluate('closed_tickets', ['team' => $team], [
      'type' => 'dimension',
      'dimension' => 'project',
      ...self::lastDays(30),
    ]);

    self::assertSame(
      ['zulu', 'mike', 'alpha', 'bravo'],
      array_column($result->getCategories(), 'label'),
    );
    self::assertSame(3, $result->getValues()[$projects['zulu']->uuid()]);
    self::assertSame(1, $result->getValues()[$projects['bravo']->uuid()]);
  }

  /**
   * Team and user bindings are intersected for both source entity types.
   */
  public function testCombinedTeamAndUserContextNarrowsTicketsAndRuns(): void {
    $workspace = $this->createWorkspace('combined');
    $team = $this->createTeam('combined', $workspace);
    $inside = $this->createProject('inside', $workspace, [$team]);
    $outside = $this->createProject('outside', $workspace);
    $alice = $this->createAccount('alice-combined');
    $bob = $this->createAccount('bob-combined');

    $aliceTicket = $this->createTicket($inside, $alice, self::NOW - self::HOUR);
    $this->createRun($aliceTicket, self::NOW - self::HOUR);
    $this->createTicket($inside, $alice, self::NOW - 3 * self::DAY);
    $bobTicket = $this->createTicket($inside, $bob, self::NOW - self::HOUR);
    $this->createRun($bobTicket, self::NOW - self::HOUR);
    $outsideTicket = $this->createTicket($outside, $alice, self::NOW - self::HOUR);
    $this->createRun($outsideTicket, self::NOW - self::HOUR);

    $contexts = ['team' => $team, 'user' => $alice];
    $categories = ['type' => 'windows', 'values' => ['day', 'week', 'month']];
    self::assertSame(
      ['day' => 1, 'week' => 2, 'month' => 2],
      $this->evaluate('closed_tickets', $contexts, $categories)->getValues(),
    );
    self::assertSame(
      ['day' => 1, 'week' => 1, 'month' => 1],
      $this->evaluate('runs', $contexts, $categories)->getValues(),
    );
  }

  /**
   * Derived division uses aligned values and returns NULL for zero divisors.
   */
  public function testDerivedRatioHandlesZeroDenominators(): void {
    $project = $this->createProject('ratio');
    $user = $this->createAccount('alice-ratio');
    $this->createTicket($project, $user, self::NOW - self::HOUR);

    $result = $this->evaluate('tickets_per_run', ['project' => $project], [
      'type' => 'windows',
      'values' => ['day', 'week', 'month'],
    ]);

    self::assertSame(['day' => NULL, 'week' => NULL, 'month' => NULL], $result->getValues());
    self::assertSame('decimal', $result->getValueType());
    self::assertSame('tickets_per_run', $result->getUnit());
  }

  /**
   * Derived dimensions retain categories that exist only in the denominator.
   */
  public function testDerivedRatioRetainsDenominatorOnlyGroupedCategories(): void {
    $workspace = $this->createWorkspace('denominator-only');
    $team = $this->createTeam('denominator-only', $workspace);
    $project = $this->createProject('denominator-only', $workspace, [$team]);
    $user = $this->createAccount('denominator-only');
    $ticket = $this->createOpenTicket($project, $user, self::NOW - self::HOUR);
    $this->createRun($ticket, self::NOW - self::HOUR);

    $result = $this->evaluate('tickets_per_run', ['team' => $team], [
      'type' => 'dimension',
      'dimension' => 'project',
      ...self::lastDays(30),
    ]);

    self::assertSame([
      ['key' => $project->uuid(), 'label' => 'denominator-only'],
    ], $result->getCategories());
    self::assertSame([$project->uuid() => 0.0], $result->getValues());
  }

  /**
   * A series expands one measurement into ranked, capped per-dimension series.
   *
   * Two buckets, three users; limit 1 keeps the largest and folds the rest
   * into `Other`, and the series of each bucket sum to that bucket's total.
   */
  public function testSeriesExpandsOneMeasurementPerDimensionValue(): void {
    $project = $this->createProject('series');
    $alice = $this->createAccount('alice-series');
    $bob = $this->createAccount('bob-series');
    $carol = $this->createAccount('carol-series');
    $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->createTicket($project, $bob, self::NOW - self::HOUR);
    $this->createTicket($project, $carol, self::NOW - 2 * self::DAY);

    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);
    $results = $this->evaluator()->evaluateSeries(
      $measurement,
      ['project' => $project],
      ['type' => 'days', ...self::lastDays(7)],
      'user',
      1,
      self::NOW,
    );

    self::assertSame(['closed_tickets:' . $alice->uuid(), 'closed_tickets:_other'], array_map(
      static fn(MeasurementResult $result): string => $result->getId(),
      $results,
    ));
    self::assertSame(['alice-series', 'Other'], array_map(
      static fn(MeasurementResult $result): string => $result->getLabel(),
      $results,
    ));

    $today = $results[0]->getValues()['2026-09-20'];
    $todayOther = $results[1]->getValues()['2026-09-20'];
    self::assertSame(2, $today);
    self::assertSame(1, $todayOther);
    $twoDaysAgo = $results[0]->getValues()['2026-09-18'];
    $twoDaysAgoOther = $results[1]->getValues()['2026-09-18'];
    self::assertSame(0, $twoDaysAgo);
    self::assertSame(1, $twoDaysAgoOther);
  }

  /**
   * Per bucket, the series sum equals the ungrouped total of the same window.
   */
  public function testSeriesBucketSumsEqualUngroupedTotal(): void {
    $project = $this->createProject('series-sum');
    $alice = $this->createAccount('alice-sum');
    $bob = $this->createAccount('bob-sum');
    $carol = $this->createAccount('carol-sum');
    $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->createTicket($project, $bob, self::NOW - self::HOUR);
    $this->createTicket($project, $carol, self::NOW - 2 * self::DAY);

    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);
    $categories = ['type' => 'days', ...self::lastDays(7)];
    $contexts = ['project' => $project];
    $series = $this->evaluator()->evaluateSeries(
      $measurement,
      $contexts,
      $categories,
      'user',
      1,
      self::NOW,
    );
    $ungrouped = $this->evaluator()->evaluate($measurement, $contexts, $categories, self::NOW);

    foreach ($ungrouped->getValues() as $bucket => $total) {
      $sum = 0;
      foreach ($series as $result) {
        $sum += $result->getValues()[$bucket];
      }
      self::assertSame($total, $sum, "bucket $bucket");
    }
  }

  /**
   * An empty dimension value is a visible Unattributed series, never dropped.
   */
  public function testSeriesNamesTheUnattributedGroup(): void {
    $project = $this->createProject('series-unattributed');
    $alice = $this->createAccount('alice-unattributed');
    $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->createUnassignedTicket($project, self::NOW - self::HOUR);

    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);
    $results = $this->evaluator()->evaluateSeries(
      $measurement,
      ['project' => $project],
      ['type' => 'days', ...self::lastDays(7)],
      'user',
      5,
      self::NOW,
    );

    self::assertContains('Unattributed', array_map(
      static fn(MeasurementResult $result): string => $result->getLabel(),
      $results,
    ));
    self::assertContains('closed_tickets:_unattributed', array_map(
      static fn(MeasurementResult $result): string => $result->getId(),
      $results,
    ));
  }

  /**
   * Empty and unloadable entity values keep distinct series ids and labels.
   */
  public function testSeriesIdsStayUniqueForEmptyAndDanglingEntityValues(): void {
    $project = $this->createProject('series-collision');
    $alice = $this->createAccount('alice-collision');
    $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->createUnassignedTicket($project, self::NOW - self::HOUR);
    $ghostTicket = $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->container->get('database')->update('bb_ticket')
      ->fields(['assignee_user_id' => 99999])
      ->condition('id', $ghostTicket->id())
      ->execute();

    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);
    $results = $this->evaluator()->evaluateSeries(
      $measurement,
      ['project' => $project],
      ['type' => 'days', ...self::lastDays(7)],
      'user',
      5,
      self::NOW,
    );

    $ids = array_map(
      static fn(MeasurementResult $result): string => $result->getId(),
      $results,
    );
    $labels = array_map(
      static fn(MeasurementResult $result): string => $result->getLabel(),
      $results,
    );
    self::assertCount(count(array_unique($ids)), $ids);
    self::assertContains('closed_tickets:_unattributed', $ids);
    self::assertContains('closed_tickets:_missing', $ids);
    self::assertContains('Unattributed', $labels);
    self::assertContains('Missing', $labels);
    self::assertCount(2, array_unique(array_intersect($labels, ['Unattributed', 'Missing'])));
  }

  /**
   * A raw dimension value `other` does not collide with the remainder series.
   */
  public function testSeriesIdsStayUniqueWhenRawValueMatchesTheRemainder(): void {
    $this->installRunModelMeasurement();
    $project = $this->createProject('series-other');
    $alice = $this->createAccount('alice-other');
    $ticket = $this->createTicket($project, $alice, self::NOW - self::HOUR);
    $this->createRun($ticket, self::NOW - self::HOUR, 'other');
    $this->createRun($ticket, self::NOW - self::HOUR, 'other');
    $this->createRun($ticket, self::NOW - self::HOUR, 'other');
    $this->createRun($ticket, self::NOW - self::HOUR, 'big');
    $this->createRun($ticket, self::NOW - self::HOUR, 'big');
    $this->createRun($ticket, self::NOW - self::HOUR, 'mid');

    $measurement = BbMeasurement::load('runs_by_model');
    self::assertNotNull($measurement);
    $results = $this->evaluator()->evaluateSeries(
      $measurement,
      ['project' => $project],
      ['type' => 'days', ...self::lastDays(7)],
      'model',
      2,
      self::NOW,
    );

    $ids = array_map(
      static fn(MeasurementResult $result): string => $result->getId(),
      $results,
    );
    $labels = array_map(
      static fn(MeasurementResult $result): string => $result->getLabel(),
      $results,
    );
    self::assertCount(count(array_unique($ids)), $ids);
    self::assertSame(['runs_by_model:other', 'runs_by_model:big', 'runs_by_model:_other'], $ids);
    self::assertSame(['other', 'big', 'Other'], $labels);
  }

  /**
   * An unknown dimension is rejected rather than silently returning nothing.
   */
  public function testSeriesRejectsAnUnknownDimension(): void {
    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('does not define dimension');
    $this->evaluator()->evaluateSeries($measurement, [], ['type' => 'days', ...self::lastDays(7)], 'nonexistent', 5, self::NOW);
  }

  /**
   * ISO-week buckets are clipped to the quarter and add up to its total.
   */
  public function testWeekBucketsClipToQuarter(): void {
    $project = $this->createProject('weeks');
    $user = $this->createAccount('alice-weeks');
    $this->createTicket($project, $user, self::at(2026, 10, 1, 12));
    $this->createTicket($project, $user, self::at(2026, 11, 15, 12));
    $this->createTicket($project, $user, self::at(2026, 12, 31, 12));
    $this->createTicket($project, $user, self::at(2027, 1, 1, 12));
    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);
    $range = ['from' => self::at(2026, 10, 1), 'to' => self::at(2026, 12, 31, 23, 59, 59)];
    $now = self::at(2027, 1, 10);

    $weeks = $this->evaluator()->evaluate($measurement, ['project' => $project], ['type' => 'weeks'] + $range, $now);
    $total = $this->evaluator()->evaluate($measurement, ['project' => $project], ['type' => 'total'] + $range, $now);

    $keys = array_column($weeks->getCategories(), 'key');
    self::assertCount(14, $keys);
    self::assertSame('2026-W40', $keys[0]);
    self::assertSame('2026-W53', $keys[13]);
    self::assertSame('W40', $weeks->getCategories()[0]['label']);
    self::assertSame(1, $weeks->getValues()['2026-W40']);
    self::assertSame(1, $weeks->getValues()['2026-W53']);
    self::assertSame(3, array_sum($weeks->getValues()));
    self::assertSame(['total' => 3], $total->getValues());
  }

  /**
   * Quarter buckets carry stable keys and mark the running quarter partial.
   */
  public function testQuarterBuckets(): void {
    $project = $this->createProject('quarters');
    $user = $this->createAccount('alice-quarters');
    $this->createTicket($project, $user, self::at(2024, 2, 10, 12));
    $this->createTicket($project, $user, self::at(2026, 10, 2, 12));
    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);

    $result = $this->evaluator()->evaluate($measurement, ['project' => $project], [
      'type' => 'quarters',
      'from' => self::at(2024, 1, 1),
      'to' => self::at(2026, 10, 24, 23, 59, 59),
    ], self::at(2026, 10, 24, 12));

    $categories = $result->getCategories();
    self::assertCount(12, $categories);
    self::assertSame(['key' => '2024-Q1', 'label' => 'Q1 2024'], $categories[0]);
    self::assertSame('2026-Q4', $categories[11]['key']);
    self::assertTrue($categories[11]['partial'] ?? FALSE);
    self::assertSame(1, $result->getValues()['2024-Q1']);
    self::assertSame(1, $result->getValues()['2026-Q4']);
  }

  /**
   * Buckets after now are shown with zero and never queried.
   */
  public function testFutureBucketsAreZeroAndUnqueried(): void {
    $project = $this->createProject('future');
    $user = $this->createAccount('alice-future');
    $this->createTicket($project, $user, self::at(2026, 10, 21, 8));
    // A record dated after now must not leak into a future bucket.
    $this->createTicket($project, $user, self::at(2026, 10, 23, 8));
    $measurement = BbMeasurement::load('closed_tickets');
    self::assertNotNull($measurement);

    $result = $this->evaluator()->evaluate($measurement, ['project' => $project], [
      'type' => 'days',
      'from' => self::at(2026, 10, 19),
      'to' => self::at(2026, 10, 25, 23, 59, 59),
    ], self::at(2026, 10, 21, 12));

    $categories = $result->getCategories();
    self::assertCount(7, $categories);
    self::assertSame(['key' => '2026-10-21', 'label' => 'Wed 21', 'partial' => TRUE], $categories[2]);
    self::assertArrayNotHasKey('partial', $categories[3]);
    self::assertSame(1, $result->getValues()['2026-10-21']);
    self::assertSame(0, $result->getValues()['2026-10-23']);
  }

  /**
   * A dimension counts only inside its range.
   */
  public function testDimensionUsesRange(): void {
    $project = $this->createProject('dimension-range');
    $user = $this->createAccount('alice-dimension-range');
    $this->createTicket($project, $user, self::at(2026, 10, 5, 12));
    $this->createTicket($project, $user, self::at(2026, 9, 30, 12));
    $this->createTicket($project, $user, self::at(2026, 11, 1, 12));
    $this->createTicket($project, $user, self::at(2026, 11, 2, 12));

    $result = $this->evaluator()->evaluate(BbMeasurement::load('closed_tickets'), ['project' => $project], [
      'type' => 'dimension',
      'dimension' => 'user',
      'from' => self::at(2026, 10, 1),
      'to' => self::at(2026, 10, 31, 23, 59, 59),
    ], self::at(2026, 12, 1));

    self::assertSame([$user->uuid() => 1], $result->getValues());
  }

  /**
   * A total is one bucket over the range up to now.
   */
  public function testTotalBucket(): void {
    $project = $this->createProject('total');
    $user = $this->createAccount('alice-total');
    $this->createTicket($project, $user, self::at(2026, 10, 2, 12));
    $this->createTicket($project, $user, self::at(2026, 10, 20, 8));
    $this->createTicket($project, $user, self::at(2026, 10, 22, 8));

    $result = $this->evaluator()->evaluate(BbMeasurement::load('closed_tickets'), ['project' => $project], [
      'type' => 'total',
      'from' => self::at(2026, 10, 1),
      'to' => self::at(2026, 10, 31, 23, 59, 59),
    ], self::at(2026, 10, 21, 12));

    self::assertSame([['key' => 'total', 'label' => 'Total', 'partial' => TRUE]], $result->getCategories());
    self::assertSame(['total' => 2], $result->getValues());
  }

  /**
   * A time category needs an explicit range.
   */
  public function testTimeCategoryWithoutRangeIsRejected(): void {
    $this->expectException(\InvalidArgumentException::class);
    $this->evaluate('closed_tickets', [], ['type' => 'days']);
  }

  /**
   * The earliest record honours bindings and spans both sides of a ratio.
   */
  public function testEarliest(): void {
    $project = $this->createProject('earliest');
    $other = $this->createProject('earliest-other');
    $user = $this->createAccount('alice-earliest');
    $ticket = $this->createTicket($project, $user, self::NOW - 5 * self::DAY);
    $this->createTicket($other, $user, self::NOW - 50 * self::DAY);
    $this->createRun($ticket, self::NOW - 9 * self::DAY);
    $this->createRun($ticket, self::NOW + self::DAY);

    $evaluator = $this->evaluator();
    $contexts = ['project' => $project];
    self::assertSame(self::NOW - 5 * self::DAY, $evaluator->earliest(BbMeasurement::load('closed_tickets'), $contexts, self::NOW));
    self::assertSame(self::NOW - 9 * self::DAY, $evaluator->earliest(BbMeasurement::load('tickets_per_run'), $contexts, self::NOW));
    self::assertNull($evaluator->earliest(BbMeasurement::load('closed_tickets'), ['project' => $this->createProject('earliest-empty')], self::NOW));
  }

  /**
   * The rating averages the job score of tickets closed in the period.
   */
  public function testRatingAveragesScoresOfTicketsClosedInPeriod(): void {
    $this->installShippedMeasurement('job_rating');
    $this->installShippedMeasurement('rated_tickets');
    $project = $this->createProject('rating');
    $user = $this->createAccount('alice-rating');
    foreach ([5, 4, 4] as $score) {
      $this->rateTicket($this->createTicket($project, $user, self::NOW - self::HOUR), $score);
    }
    $this->createTicket($project, $user, self::NOW - self::HOUR);
    // Rated, but closed before the period.
    $this->rateTicket($this->createTicket($project, $user, self::NOW - 40 * self::DAY), 1);

    $total = ['type' => 'total', ...self::lastDays(30)];
    $rating = $this->evaluate('job_rating', ['project' => $project], $total)->getValues()['total'];
    self::assertEqualsWithDelta(4.33, $rating, 0.01);
    self::assertSame(3, $this->evaluate('rated_tickets', ['project' => $project], $total)->getValues()['total']);
  }

  /**
   * Only the score row of a ticket counts, never another metric's value.
   */
  public function testRatingIgnoresOtherMetricRowsOfTheSameTicket(): void {
    $this->installShippedMeasurement('job_rating');
    $project = $this->createProject('rating-rows');
    $ticket = $this->createTicket($project, $this->createAccount('alice-rating-rows'), self::NOW - self::HOUR);
    $ticket->set('metrics', [
      ['name' => 'other.metric', 'value' => 100],
      ['name' => 'job_rating.score', 'value' => 2],
    ])->save();

    $values = $this->evaluate('job_rating', ['project' => $project], ['type' => 'total', ...self::lastDays(30)])->getValues();
    self::assertEqualsWithDelta(2.0, $values['total'], 0.001);
  }

  /**
   * Without a rated ticket the rating is unknown, never zero.
   */
  public function testRatingIsNullWhenNothingIsRated(): void {
    $this->installShippedMeasurement('job_rating');
    $project = $this->createProject('rating-none');
    $this->createTicket($project, $this->createAccount('alice-rating-none'), self::NOW - self::HOUR);

    $values = $this->evaluate('job_rating', ['project' => $project], ['type' => 'total', ...self::lastDays(30)])->getValues();
    self::assertNull($values['total']);
  }

  /**
   * A rating grouped by project keeps its decimals.
   */
  public function testRatingGroupedByProjectKeepsDecimals(): void {
    $this->installShippedMeasurement('job_rating');
    $workspace = $this->createWorkspace('rating-grouped');
    $alpha = $this->createProject('alpha-rating', $workspace);
    $beta = $this->createProject('beta-rating', $workspace);
    $user = $this->createAccount('alice-rating-grouped');
    $this->rateTicket($this->createTicket($alpha, $user, self::NOW - self::HOUR), 5);
    $this->rateTicket($this->createTicket($alpha, $user, self::NOW - self::HOUR), 4);
    $this->rateTicket($this->createTicket($beta, $user, self::NOW - self::HOUR), 3);

    $values = $this->evaluate('job_rating', ['workspace' => $workspace], [
      'type' => 'dimension',
      'dimension' => 'project',
      ...self::lastDays(30),
    ])->getValues();
    self::assertEqualsWithDelta(4.5, $values[$alpha->uuid()], 0.001);
    self::assertEqualsWithDelta(3.0, $values[$beta->uuid()], 0.001);
  }

  /**
   * A UTC timestamp.
   */
  private static function at(int $year, int $month, int $day, int $hour = 0, int $minute = 0, int $second = 0): int {
    return (int) gmmktime($hour, $minute, $second, $month, $day, $year);
  }

  /**
   * The trailing calendar days ending today, as a category range.
   *
   * @return array{from: int, to: int}
   *   The inclusive range.
   */
  private static function lastDays(int $days): array {
    $today = intdiv(self::NOW, self::DAY) * self::DAY;
    return ['from' => $today - ($days - 1) * self::DAY, 'to' => $today + self::DAY - 1];
  }

  /**
   * Evaluates one configured measurement.
   *
   * @param string $id
   *   The measurement ID.
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named context entities.
   * @param array<string, mixed> $categories
   *   The category configuration.
   */
  private function evaluate(string $id, array $contexts, array $categories): MeasurementResult {
    $measurement = BbMeasurement::load($id);
    self::assertNotNull($measurement);
    return $this->evaluator()->evaluate($measurement, $contexts, $categories, self::NOW);
  }

  /**
   * Gets the measurement evaluator service.
   */
  private function evaluator(): MeasurementEvaluatorInterface {
    $evaluator = $this->container->get('bb_core.measurement_evaluator');
    self::assertInstanceOf(MeasurementEvaluatorInterface::class, $evaluator);
    return $evaluator;
  }

  /**
   * Installs the measurement fixtures.
   */
  private function installMeasurements(): void {
    foreach ([
      [
        'id' => 'closed_tickets',
        'label' => 'Closed tickets',
        'value_type' => 'integer',
        'unit' => 'tickets',
        'source' => ['entity_type' => 'bb_ticket', 'time_field' => 'closed_date'],
        'operation' => ['type' => 'count'],
        'predicates' => [['field' => 'closed', 'operator' => '=', 'value' => TRUE]],
        'bindings' => [
          'workspace' => ['field' => 'project_id', 'resolver' => 'workspace_projects'],
          'project' => ['field' => 'project_id', 'resolver' => 'entity_id'],
          'team' => ['field' => 'project_id', 'resolver' => 'team_projects'],
          'user' => ['field' => 'assignee_user_id', 'resolver' => 'entity_id'],
        ],
        'dimensions' => [
          'project' => ['field' => 'project_id', 'entity_type' => 'bb_project'],
          'user' => ['field' => 'assignee_user_id', 'entity_type' => 'user'],
        ],
      ],
      [
        'id' => 'runs',
        'label' => 'Runs',
        'value_type' => 'integer',
        'unit' => 'runs',
        'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
        'operation' => ['type' => 'count'],
        'predicates' => [],
        'bindings' => [
          'workspace' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'workspace_projects'],
          'project' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'entity_id'],
          'team' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'team_projects'],
          'user' => ['field' => 'ticket_id.entity.assignee_user_id', 'resolver' => 'entity_id'],
        ],
        'dimensions' => [
          'project' => ['field' => 'ticket_id.entity.project_id', 'entity_type' => 'bb_project'],
          'user' => ['field' => 'ticket_id.entity.assignee_user_id', 'entity_type' => 'user'],
        ],
      ],
      [
        'id' => 'tickets_per_run',
        'label' => 'Tickets per run',
        'value_type' => 'decimal',
        'unit' => 'tickets_per_run',
        'source' => [],
        'operation' => [
          'type' => 'divide',
          'numerator' => 'closed_tickets',
          'denominator' => 'runs',
        ],
        'predicates' => [],
        'bindings' => [],
        'dimensions' => [],
      ],
    ] as $definition) {
      BbMeasurement::create($definition)->save();
    }
  }

  /**
   * Creates and saves a workspace.
   */
  private function createWorkspace(string $name): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create(['name' => $name]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    return $workspace;
  }

  /**
   * Creates and saves a team.
   */
  private function createTeam(string $name, BbWorkspaceInterface $workspace): BbTeamInterface {
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => $name, 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    return $team;
  }

  /**
   * Creates and saves a project.
   *
   * @param string $name
   *   The project name.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|null $workspace
   *   The optional workspace.
   * @param array<BbTeamInterface> $teams
   *   The assigned teams.
   */
  private function createProject(string $name, ?BbWorkspaceInterface $workspace = NULL, array $teams = []): BbProjectInterface {
    $values = [
      'name' => $name,
      'teams' => array_map(
        static fn(BbTeamInterface $team): int => (int) $team->id(),
        $teams,
      ),
    ];
    if ($workspace !== NULL) {
      $group = $this->container->get('entity_type.manager')
        ->getStorage('bb_group')
        ->create([
          'name' => $name . '-group',
          'workspace_id' => $workspace->id(),
        ]);
      $group->save();
      $values['group_id'] = $group->id();
    }
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create($values);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates and saves a user account.
   */
  private function createAccount(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a closed ticket with no assignee.
   */
  private function createUnassignedTicket(BbProjectInterface $project, int $closedDate): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'unassigned-' . mt_rand(),
      'project_id' => $project->id(),
      'created' => $closedDate,
      'closed' => TRUE,
      'closed_date' => $closedDate,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates and saves a closed ticket.
   */
  private function createTicket(BbProjectInterface $project, UserInterface $assignee, int $closedDate): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'ticket-' . mt_rand(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee->id(),
      'created' => $closedDate,
      'closed' => TRUE,
      'closed_date' => $closedDate,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates and saves an open ticket.
   */
  private function createOpenTicket(BbProjectInterface $project, UserInterface $assignee, int $created): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'open-' . mt_rand(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee->id(),
      'created' => $created,
      'closed' => FALSE,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Installs one measurement exactly as shipped in config/sync.
   */
  private function installShippedMeasurement(string $id): void {
    $data = (new FileStorage(dirname($this->root) . '/config/sync'))->read("bb_core.bb_measurement.$id");
    self::assertIsArray($data, "config/sync/bb_core.bb_measurement.$id.yml exists.");
    BbMeasurement::create($data)->save();
  }

  /**
   * Creates a ticket at a creation time, closed at the given time or open.
   */
  private function createTicketAt(BbProjectInterface $project, ?UserInterface $assignee, int $created, ?int $closedDate): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'at-' . mt_rand(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee?->id(),
      'created' => $created,
      'closed' => $closedDate !== NULL,
      'closed_date' => $closedDate,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Counts tickets closed in the period with more than three runs in total.
   */
  public function testManyRunsCountsClosedTicketsWithMoreThanThreeRunsEver(): void {
    $this->installShippedMeasurement('closed_tickets_many_runs');
    $project = $this->createProject('many-runs');
    $user = $this->createAccount('alice-many-runs');
    $a = $this->createTicket($project, $user, self::NOW - self::HOUR);
    $this->createRun($a, self::NOW - 60 * self::DAY);
    foreach (range(1, 3) as $i) {
      $this->createRun($a, self::NOW - $i * self::HOUR);
    }
    $b = $this->createTicket($project, $user, self::NOW - self::HOUR);
    foreach (range(1, 3) as $i) {
      $this->createRun($b, self::NOW - $i * self::HOUR);
    }
    $c = $this->createOpenTicket($project, $user, self::NOW - self::DAY);
    foreach (range(1, 5) as $i) {
      $this->createRun($c, self::NOW - $i * self::HOUR);
    }

    $total = ['type' => 'total', ...self::lastDays(30)];
    self::assertSame(1, $this->evaluate('closed_tickets_many_runs', ['project' => $project], $total)->getValues()['total']);
    $byUser = $this->evaluate('closed_tickets_many_runs', ['project' => $project], [
      'type' => 'dimension',
      'dimension' => 'user',
      ...self::lastDays(30),
    ])->getValues();
    self::assertSame([$user->uuid() => 1], $byUser);
  }

  /**
   * Tokens per ticket divides run tokens by closed tickets.
   */
  public function testTokensPerTicketDividesTokensByClosed(): void {
    $this->installShippedMeasurement('run_tokens');
    $this->installShippedMeasurement('tokens_per_ticket');
    $project = $this->createProject('tokens-per-ticket');
    $user = $this->createAccount('alice-tokens-per-ticket');
    for ($n = 0; $n < 4; $n++) {
      $ticket = $this->createTicket($project, $user, self::NOW - self::HOUR);
      $this->createRun($ticket, self::NOW - self::HOUR, '', 250);
    }
    $empty = $this->createProject('tokens-per-ticket-empty');
    $this->createRun($this->createOpenTicket($empty, $user, self::NOW - self::DAY), self::NOW - self::HOUR, '', 1000);

    $total = ['type' => 'total', ...self::lastDays(30)];
    self::assertSame(250.0, $this->evaluate('tokens_per_ticket', ['project' => $project], $total)->getValues()['total']);
    self::assertNull($this->evaluate('tokens_per_ticket', ['project' => $empty], $total)->getValues()['total']);
  }

  /**
   * A filled project dimension lists every project in scope, idle ones at 0.
   */
  public function testFilledProjectDimensionListsProjectsWithoutActivity(): void {
    $this->installShippedMeasurement('job_rating');
    $workspace = $this->createWorkspace('filled');
    $busy = $this->createProject('busy', $workspace);
    $idle = $this->createProject('idle', $workspace);
    $this->createProject('foreign', $this->createWorkspace('filled-other'));
    $this->createTicket($busy, $this->createAccount('alice-filled'), self::NOW - self::HOUR);

    $definition = ['type' => 'dimension', 'dimension' => 'project', 'fill' => TRUE, ...self::lastDays(30)];
    self::assertSame(
      [$busy->uuid() => 1, $idle->uuid() => 0],
      $this->evaluate('closed_tickets', ['workspace' => $workspace], $definition)->getValues(),
    );
    $rating = $this->evaluate('job_rating', ['workspace' => $workspace], $definition)->getValues();
    self::assertSame([$busy->uuid(), $idle->uuid()], array_keys($rating));
    self::assertNull($rating[$idle->uuid()]);
  }

  /**
   * A team restriction narrows the filled projects to the team's projects.
   */
  public function testFilledDimensionRespectsTeamRestriction(): void {
    $workspace = $this->createWorkspace('filled-team');
    $team = $this->createTeam('filled-team', $workspace);
    $own = $this->createProject('own', $workspace, [$team]);
    $this->createProject('other', $workspace);

    $values = $this->evaluate('closed_tickets', ['workspace' => $workspace, 'team' => [$team]], [
      'type' => 'dimension',
      'dimension' => 'project',
      'fill' => TRUE,
      ...self::lastDays(30),
    ])->getValues();
    self::assertSame([$own->uuid() => 0], $values);
  }

  /**
   * The ticket dimension groups ticket and run measurements per ticket.
   */
  public function testTicketDimensionGroupsPerTicket(): void {
    foreach (['closed_tickets', 'runs'] as $id) {
      BbMeasurement::load($id)?->delete();
    }
    foreach (['closed_tickets', 'runs', 'run_tokens', 'job_rating', 'rated_tickets'] as $id) {
      $this->installShippedMeasurement($id);
    }
    $project = $this->createProject('per-ticket');
    $user = $this->createAccount('alice-per-ticket');
    $rated = $this->createTicket($project, $user, self::NOW - self::HOUR);
    $this->rateTicket($rated, 4);
    $this->createRun($rated, self::NOW - 2 * self::HOUR, '', 100);
    $this->createRun($rated, self::NOW - self::HOUR, '', 50);
    $idle = $this->createTicket($project, $user, self::NOW - self::HOUR);

    $definition = ['type' => 'dimension', 'dimension' => 'ticket', ...self::lastDays(30)];
    $context = ['user' => $user];
    $closed = $this->evaluate('closed_tickets', $context, $definition);
    self::assertEquals([$rated->uuid() => 1, $idle->uuid() => 1], $closed->getValues());
    self::assertEqualsCanonicalizing(
      [(string) $rated->label(), (string) $idle->label()],
      array_column($closed->getCategories(), 'label'),
    );
    self::assertSame([$rated->uuid() => 2], $this->evaluate('runs', $context, $definition)->getValues());
    self::assertSame([$rated->uuid() => 150], $this->evaluate('run_tokens', $context, $definition)->getValues());
    self::assertSame([$rated->uuid() => 1], $this->evaluate('rated_tickets', $context, $definition)->getValues());
    self::assertEqualsWithDelta(4.0, $this->evaluate('job_rating', $context, $definition)->getValues()[$rated->uuid()], 0.001);
  }

  /**
   * Records a job rating on a ticket.
   */
  private function rateTicket(BbTicketInterface $ticket, int $score): void {
    $ticket->set('metrics', [['name' => 'job_rating.score', 'value' => $score]])->save();
  }

  /**
   * Creates and saves a run.
   */
  private function createRun(BbTicketInterface $ticket, int $created, string $model = '', int $tokens = 0): void {
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'running',
      'state_at_start' => 'working',
      'created' => $created,
      'model' => $model,
      'tokens' => $tokens,
    ]);
    $run->save();
  }

  /**
   * Saves a run-count measurement grouped by the scalar model field.
   */
  private function installRunModelMeasurement(): void {
    BbMeasurement::create([
      'id' => 'runs_by_model',
      'label' => 'Runs by model',
      'value_type' => 'integer',
      'unit' => 'runs',
      'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
      'operation' => ['type' => 'count'],
      'predicates' => [],
      'bindings' => [
        'workspace' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'workspace_projects'],
        'project' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'entity_id'],
        'team' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'team_projects'],
        'user' => ['field' => 'ticket_id.entity.assignee_user_id', 'resolver' => 'entity_id'],
      ],
      'dimensions' => [
        'model' => ['field' => 'model'],
      ],
    ])->save();
  }

}
