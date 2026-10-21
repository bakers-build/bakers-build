<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementEvaluatorInterface;
use Drupal\bb_core\Statistics\Measurement\MeasurementResult;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers measurement completeness: sum, scalar axis, months, states.
 *
 * The BB-513 architecture ships count/divide over windows/days/dimension;
 * BB-516 adds a `sum:<field>` operation (token spend), a scalar dimension
 * (a run's model, with no entity behind it), a `months` category, and
 * string predicates (a per-state measurement). This exercises each on the
 * real evaluator service.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MeasurementCompletenessTest extends KernelTestBase {

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
   * A sum operation totals a source field over the trailing windows.
   */
  public function testSumMeasureTotalsTheField(): void {
    $project = $this->createProject('sum');
    $ticket = $this->createTicket($project, $this->createAccount('sum-user'));
    $this->createRun($ticket, self::NOW - self::HOUR, 100, 'done', 'opus');
    $this->createRun($ticket, self::NOW - self::HOUR, 250, 'done', 'sonnet');
    $this->createRun($ticket, self::NOW - 40 * self::DAY, 9000, 'done', 'opus');

    $result = $this->evaluate('run_tokens', ['project' => $project], [
      'type' => 'windows',
      'values' => ['day', 'week', 'month'],
    ]);
    self::assertSame(['day' => 350, 'week' => 350, 'month' => 350], $result->getValues());
    self::assertSame('tokens', $result->getUnit());
  }

  /**
   * A scalar dimension groups by a raw value with no entity to load.
   */
  public function testScalarModelDimensionIsItsOwnLabel(): void {
    $project = $this->createProject('scalar');
    $ticket = $this->createTicket($project, $this->createAccount('scalar-user'));
    $this->createRun($ticket, self::NOW - self::HOUR, 100, 'done', 'opus');
    $this->createRun($ticket, self::NOW - self::HOUR, 250, 'done', 'sonnet');
    $this->createRun($ticket, self::NOW - self::HOUR, 700, 'done', 'opus');

    $result = $this->evaluate('run_tokens', ['project' => $project], [
      'type' => 'dimension',
      'dimension' => 'model',
      'period' => 30,
    ]);
    $byLabel = [];
    foreach ($result->getCategories() as $category) {
      $byLabel[$category['label']] = $result->getValues()[$category['key']];
    }
    self::assertSame(800, $byLabel['opus']);
    self::assertSame(250, $byLabel['sonnet']);
  }

  /**
   * A missing scalar value folds into the unattributed row.
   */
  public function testScalarDimensionFoldsEmptyIntoUnattributed(): void {
    $project = $this->createProject('scalar-empty');
    $ticket = $this->createTicket($project, $this->createAccount('scalar-empty-user'));
    $this->createRun($ticket, self::NOW - self::HOUR, 5, 'done', NULL);

    $result = $this->evaluate('run_tokens', ['project' => $project], [
      'type' => 'dimension',
      'dimension' => 'model',
      'period' => 30,
    ]);
    self::assertSame('Unattributed', $result->getCategories()[0]['label']);
    self::assertSame(5, $result->getValues()['unattributed']);
  }

  /**
   * A months category returns twelve real calendar months, oldest first.
   */
  public function testMonthsCategoryReturnsTwelveCalendarMonths(): void {
    $pinned = (int) gmmktime(12, 0, 0, 3, 15, 2026);
    $project = $this->createProject('months');
    $ticket = $this->createTicket($project, $this->createAccount('months-user'));
    // A run at 2026-02-28 23:59:59Z and one at 2026-03-01 00:00:00Z land in
    // different buckets — the real month boundary, not a 30-day slice.
    $this->createRun($ticket, (int) gmmktime(23, 59, 59, 2, 28, 2026), 10, 'done', 'opus');
    $this->createRun($ticket, (int) gmmktime(0, 0, 0, 3, 1, 2026), 10, 'done', 'opus');

    $result = $this->evaluator()->evaluate(
      $this->measurement('runs'),
      ['project' => $project],
      ['type' => 'months'],
      $pinned,
    );
    $categories = $result->getCategories();
    self::assertCount(12, $categories);
    self::assertSame('2025-04', $categories[0]['key']);
    self::assertSame('2026-03', $categories[11]['key']);
    self::assertTrue($categories[11]['partial'] ?? FALSE);
    self::assertSame(1, $result->getValues()['2026-02']);
    self::assertSame(1, $result->getValues()['2026-03']);
  }

  /**
   * A string predicate narrows a measurement to one run state.
   */
  public function testStringPredicateNarrowsToOneState(): void {
    $project = $this->createProject('state');
    $ticket = $this->createTicket($project, $this->createAccount('state-user'));
    $this->createRun($ticket, self::NOW - self::HOUR, 100, 'done', 'opus');
    $this->createRun($ticket, self::NOW - self::HOUR, 700, 'failed', 'opus');

    $result = $this->evaluate('run_tokens_failed', ['project' => $project], [
      'type' => 'windows',
      'values' => ['day'],
    ]);
    self::assertSame(['day' => 700], $result->getValues());
  }

  /**
   * Evaluates one configured measurement at the fixed now.
   *
   * @param string $id
   *   The measurement ID.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named context entities.
   * @param array<string, mixed> $categories
   *   The category configuration.
   */
  private function evaluate(string $id, array $contexts, array $categories): MeasurementResult {
    return $this->evaluator()->evaluate($this->measurement($id), $contexts, $categories, self::NOW);
  }

  /**
   * Loads a configured measurement.
   */
  private function measurement(string $id): BbMeasurement {
    $measurement = BbMeasurement::load($id);
    self::assertInstanceOf(BbMeasurement::class, $measurement);
    return $measurement;
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
   * Installs the token/state measurement fixtures.
   */
  private function installMeasurements(): void {
    $runBindings = [
      'workspace' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'workspace_projects'],
      'project' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'entity_id'],
      'team' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'team_projects'],
      'user' => ['field' => 'ticket_id.entity.assignee_user_id', 'resolver' => 'entity_id'],
    ];
    $runDimensions = [
      'user' => ['field' => 'ticket_id.entity.assignee_user_id', 'entity_type' => 'user'],
      'model' => ['field' => 'model'],
    ];
    BbMeasurement::create([
      'id' => 'runs',
      'label' => 'Runs',
      'value_type' => 'integer',
      'unit' => 'runs',
      'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
      'operation' => ['type' => 'count'],
      'predicates' => [],
      'bindings' => $runBindings,
      'dimensions' => $runDimensions,
    ])->save();
    BbMeasurement::create([
      'id' => 'run_tokens',
      'label' => 'Token spend',
      'value_type' => 'integer',
      'unit' => 'tokens',
      'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
      'operation' => ['type' => 'sum', 'field' => 'tokens'],
      'predicates' => [],
      'bindings' => $runBindings,
      'dimensions' => $runDimensions,
    ])->save();
    BbMeasurement::create([
      'id' => 'run_tokens_failed',
      'label' => 'Token spend (failed)',
      'value_type' => 'integer',
      'unit' => 'tokens',
      'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
      'operation' => ['type' => 'sum', 'field' => 'tokens'],
      'predicates' => [['field' => 'state', 'operator' => '=', 'value' => 'failed']],
      'bindings' => $runBindings,
      'dimensions' => $runDimensions,
    ])->save();
  }

  /**
   * Creates and saves a project.
   */
  private function createProject(string $name): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create(['name' => $name]);
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
   * Creates and saves a ticket.
   */
  private function createTicket(BbProjectInterface $project, UserInterface $assignee): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_bug',
      'title' => 'ticket-' . mt_rand(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates and saves a run with tokens, state and model.
   */
  private function createRun(BbTicketInterface $ticket, int $created, int $tokens, string $state, ?string $model): void {
    $values = [
      'ticket_id' => $ticket->id(),
      'state' => $state,
      'state_at_start' => 'coding',
      'created' => $created,
      'tokens' => $tokens,
    ];
    if ($model !== NULL) {
      $values['model'] = $model;
    }
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create($values)->save();
  }

}
