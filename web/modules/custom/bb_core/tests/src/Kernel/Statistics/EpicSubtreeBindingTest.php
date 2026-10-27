<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Statistics\Measurement\ContextBindingResolver;
use Drupal\bb_core\Statistics\Measurement\MeasurementQuery;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the epic binding: an epic counts itself and its whole subtree.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EpicSubtreeBindingTest extends KernelTestBase {

  use EpicTermTrait;

  use OgScopeFixtureTrait;
  use InsightsFixtureTrait;

  private const NOW = 1789920000;

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
   * The project holding the epic.
   */
  private BbProjectInterface $project;

  /**
   * The epic, its child and grandchild, and a ticket outside the subtree.
   *
   * @var array<string, \Drupal\bb_core\Entity\BbTicketInterface>
   */
  private array $tickets = [];

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
    $this->installInsightsFigures();
    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')->create(['name' => 'north']);
    $workspace->save();
    $this->project = $this->project($workspace->id(), 'atlas');
    $other = $this->project($workspace->id(), 'pfiff');
    $this->tickets['E'] = $this->ticket($this->project, 'epic', NULL, 0);
    $this->tickets['C'] = $this->ticket($this->project, 'bb_work', $this->tickets['E'], 0);
    $this->tickets['G'] = $this->ticket($this->project, 'bb_work', $this->tickets['C'], 100);
    $this->tickets['X'] = $this->ticket($this->project, 'bb_work', NULL, 50);
    $this->tickets['Y'] = $this->ticket($other, 'bb_work', NULL, 0);
  }

  /**
   * The subtree holds the epic, its children and grandchildren.
   */
  public function testSubtreeIncludesEpicAndDescendants(): void {
    $ids = $this->resolver()->resolve(['resolver' => 'epic_subtree'], $this->tickets['E']);
    sort($ids);
    self::assertSame([
      (int) $this->tickets['E']->id(),
      (int) $this->tickets['C']->id(),
      (int) $this->tickets['G']->id(),
    ], array_map('intval', $ids));
  }

  /**
   * A parent cycle ends instead of looping.
   */
  public function testCyclicParentChainTerminates(): void {
    $this->tickets['E']->set('parent_id', $this->tickets['G']->id())->save();
    $ids = $this->resolver()->resolve(['resolver' => 'epic_subtree'], $this->tickets['C']);
    self::assertCount(3, $ids);
  }

  /**
   * Closed tickets count only the epic's subtree.
   */
  public function testClosedTicketsCountsOnlySubtree(): void {
    self::assertSame(3, $this->query()->count($this->measurement('closed_tickets'), $this->contexts(), 0, self::NOW));
  }

  /**
   * Run tokens follow their ticket into the subtree.
   */
  public function testRunTokensFollowTheirTicket(): void {
    self::assertSame(100, $this->query()->sum($this->measurement('run_tokens'), $this->contexts(), 0, self::NOW));
  }

  /**
   * Only a ticket can be an epic context.
   */
  public function testNonTicketContextIsRejected(): void {
    $this->expectException(\InvalidArgumentException::class);
    $this->resolver()->resolve(['resolver' => 'epic_subtree'], $this->project);
  }

  /**
   * The project and epic contexts of the filtered page.
   *
   * @return array<string, mixed>
   *   The contexts.
   */
  private function contexts(): array {
    return ['project' => $this->project, 'epic' => [$this->tickets['E']]];
  }

  /**
   * The binding resolver service.
   */
  private function resolver(): ContextBindingResolver {
    return $this->container->get('bb_core.measurement_context_binding_resolver');
  }

  /**
   * The measurement query service.
   */
  private function query(): MeasurementQuery {
    return $this->container->get('bb_core.measurement_query');
  }

  /**
   * Loads a shipped measurement.
   */
  private function measurement(string $id): BbMeasurement {
    $measurement = BbMeasurement::load($id);
    self::assertInstanceOf(BbMeasurement::class, $measurement);
    return $measurement;
  }

  /**
   * Creates a project in a workspace.
   */
  private function project(int|string $workspaceId, string $name): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $workspaceId]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create(['name' => $name, 'group_id' => $group->id()]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates a ticket closed yesterday, with one run when tokens are given.
   */
  private function ticket(BbProjectInterface $project, string $workflow, ?BbTicketInterface $parent, int $tokens): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager');
    $ticket = $storage->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'ticket_type' => $workflow === 'epic' ? $this->epicTerm($project)->id() : NULL,
      'title' => 'subtree-' . mt_rand(),
      'project_id' => $project->id(),
      'parent_id' => $parent?->id(),
      'created' => self::NOW - 86400,
      'closed' => TRUE,
      'closed_date' => self::NOW - 86400,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    if ($tokens > 0) {
      $storage->getStorage('bb_run')->create([
        'ticket_id' => $ticket->id(),
        'state' => 'running',
        'state_at_start' => 'working',
        'created' => self::NOW - 86400,
        'model' => 'claude-opus',
        'tokens' => $tokens,
      ])->save();
    }
    return $ticket;
  }

}
