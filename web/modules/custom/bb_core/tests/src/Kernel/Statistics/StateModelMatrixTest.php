<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the token spend by state and model matrix (BB-516).
 *
 * The two-axis crosstab the original spec asked for is expressed on the
 * BB-513 architecture as one sum:tokens measurement per run state (rows)
 * over a scalar `model` dimension (columns): FigureEvaluator::align() unions
 * the model categories across the five state measurements, so the matrix
 * reads state x model with token sums in the cells.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class StateModelMatrixTest extends KernelTestBase {

  private const NOW = 1789920000;
  private const HOUR = 3600;

  private const STATES = ['claimed', 'running', 'done', 'expired', 'failed'];

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
   * The project the matrix figure is read for.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'bb_workspace', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    foreach (self::STATES as $state) {
      BbMeasurement::create([
        'id' => "run_tokens_$state",
        'label' => ucfirst($state) . ' token spend',
        'value_type' => 'integer',
        'unit' => 'tokens',
        'source' => ['entity_type' => 'bb_run', 'time_field' => 'created'],
        'operation' => ['type' => 'sum', 'field' => 'tokens'],
        'predicates' => [['field' => 'state', 'operator' => '=', 'value' => $state]],
        'bindings' => ['project' => ['field' => 'ticket_id.entity.project_id', 'resolver' => 'entity_id']],
        'dimensions' => ['model' => ['field' => 'model']],
      ])->save();
    }
    BbFigure::create([
      'id' => 'tokens_by_state_model',
      'label' => 'Token spend by state and model',
      'description' => 'State x model.',
      'weight' => 0,
      'widget' => 'matrix',
      'measurements' => array_map(static fn(string $s): string => "run_tokens_$s", self::STATES),
      'categories' => ['type' => 'dimension', 'dimension' => 'model'],
      'filters' => [],
      'context_shape' => ['project'],
      'conditions' => [],
    ])->save();

    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create(['name' => 'matrix']);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    $this->project = $project;
    $ticket = $this->createTicket();
    // done/sonnet 100+250=350, done/opus 700, failed/opus 40, one modelless 5.
    $this->createRun($ticket, 100, 'done', 'sonnet');
    $this->createRun($ticket, 250, 'done', 'sonnet');
    $this->createRun($ticket, 700, 'done', 'opus');
    $this->createRun($ticket, 40, 'failed', 'opus');
    $this->createRun($ticket, 5, 'done', NULL);
  }

  /**
   * The matrix rows are the states and the columns are the models.
   */
  public function testMatrixCrossesStateByModel(): void {
    $payload = $this->evaluator()
      ->evaluate(BbFigure::load('tokens_by_state_model'), ['project' => $this->project], [], self::NOW)
      ->toArray();

    self::assertSame('matrix', $payload['widget']);
    // Rows: one measurement per state, in configured order.
    self::assertSame(
      ['run_tokens_claimed', 'run_tokens_running', 'run_tokens_done', 'run_tokens_expired', 'run_tokens_failed'],
      array_column($payload['measurements'], 'id'),
    );
    // Columns: the union of models seen across the state measurements, plus
    // the unattributed column for the model-less run.
    $columns = array_column($payload['categories'], 'label');
    self::assertContains('opus', $columns);
    self::assertContains('sonnet', $columns);
    self::assertContains('Unattributed', $columns);

    $byId = [];
    foreach ($payload['measurements'] as $measurement) {
      $byId[$measurement['id']] = $measurement['values'];
    }
    $opus = $this->columnKey($payload['categories'], 'opus');
    $sonnet = $this->columnKey($payload['categories'], 'sonnet');
    $none = $this->columnKey($payload['categories'], 'Unattributed');
    self::assertSame(700, $byId['run_tokens_done'][$opus]);
    self::assertSame(350, $byId['run_tokens_done'][$sonnet]);
    self::assertSame(5, $byId['run_tokens_done'][$none]);
    self::assertSame(40, $byId['run_tokens_failed'][$opus]);
    // A state with no runs is an all-zero row, not an absent one.
    self::assertSame(0, $byId['run_tokens_running'][$opus]);
  }

  /**
   * Finds the category key whose label matches.
   *
   * @param array<int, array<string, mixed>> $categories
   *   The figure categories.
   * @param string $label
   *   The label to find.
   */
  private function columnKey(array $categories, string $label): string {
    foreach ($categories as $category) {
      if ($category['label'] === $label) {
        return (string) $category['key'];
      }
    }
    self::fail("No column labelled $label.");
  }

  /**
   * Gets the figure evaluator service.
   */
  private function evaluator(): FigureEvaluator {
    $evaluator = $this->container->get('bb_core.figure_evaluator');
    self::assertInstanceOf(FigureEvaluator::class, $evaluator);
    return $evaluator;
  }

  /**
   * Creates and saves a ticket on the fixture project.
   */
  private function createTicket(): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'ticket-' . mt_rand(),
      'project_id' => $this->project->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates and saves a run with tokens, state and model.
   */
  private function createRun(BbTicketInterface $ticket, int $tokens, string $state, ?string $model): void {
    $values = [
      'ticket_id' => $ticket->id(),
      'state' => $state,
      'state_at_start' => 'coding',
      'created' => self::NOW - self::HOUR,
      'tokens' => $tokens,
    ];
    if ($model !== NULL) {
      $values['model'] = $model;
    }
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create($values)->save();
  }

}
