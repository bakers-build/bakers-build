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
   * Daily categories are oldest first and include explicit zeroes.
   */
  public function testDailyCategoriesCoverTheSelectedPeriod(): void {
    $project = $this->createProject('days');
    $user = $this->createAccount('alice-days');
    $this->createTicket($project, $user, self::NOW - self::HOUR);
    $this->createTicket($project, $user, self::NOW - 2 * self::DAY);

    $result = $this->evaluate('closed_tickets', ['project' => $project], [
      'type' => 'days',
      'period' => 7,
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
      'period' => 30,
    ]);
    self::assertSame(['alpha', 'beta'], array_column($projects->getCategories(), 'label'));
    self::assertSame(2, $projects->getValues()[$alpha->uuid()]);
    self::assertSame(1, $projects->getValues()[$beta->uuid()]);

    $users = $this->evaluate('closed_tickets', ['team' => $team], [
      'type' => 'dimension',
      'dimension' => 'user',
      'period' => 30,
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
      'period' => 30,
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
      'period' => 30,
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
      ['type' => 'days', 'period' => 7],
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
    $categories = ['type' => 'days', 'period' => 7];
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
      ['type' => 'days', 'period' => 7],
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
      ['type' => 'days', 'period' => 7],
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
      ['type' => 'days', 'period' => 7],
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
    $this->evaluator()->evaluateSeries($measurement, [], ['type' => 'days', 'period' => 7], 'nonexistent', 5, self::NOW);
  }

  /**
   * Evaluates one configured measurement.
   *
   * @param string $id
   *   The measurement ID.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
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
   * Creates and saves a run.
   */
  private function createRun(BbTicketInterface $ticket, int $created, string $model = ''): void {
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'running',
      'state_at_start' => 'coding',
      'created' => $created,
      'model' => $model,
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
