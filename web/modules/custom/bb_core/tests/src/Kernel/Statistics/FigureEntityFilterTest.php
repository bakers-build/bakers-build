<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\Core\Config\FileStorage;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers project, team and person filters on a workspace figure.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class FigureEntityFilterTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  private const NOW = 1789920000;
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
   * The workspace every figure is evaluated for.
   */
  private BbWorkspaceInterface $workspace;

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
    $data = (new FileStorage(dirname($this->root) . '/config/sync'))->read('bb_core.bb_measurement.closed_tickets');
    self::assertIsArray($data);
    BbMeasurement::create($data)->save();
    BbFigure::create([
      'id' => 'filtered_closed',
      'label' => 'Closed',
      'widget' => 'matrix',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'total'],
      'filters' => [
        'period' => [
          'label' => 'Period',
          'default' => 'month',
          'options' => [['value' => 'month', 'label' => 'Month']],
        ],
        'project' => ['label' => 'Project', 'type' => 'entities', 'binding' => 'project'],
        'team' => ['label' => 'Team', 'type' => 'entities', 'binding' => 'team'],
        'user' => ['label' => 'Person', 'type' => 'entities', 'binding' => 'user'],
      ],
      'context_shape' => ['workspace'],
      'conditions' => [],
    ])->save();
    $this->workspace = $this->createWorkspace('north');
  }

  /**
   * A project filter narrows the workspace figure to that project.
   */
  public function testProjectFilterNarrowsWorkspaceFigures(): void {
    $p1 = $this->createProject('p1', $this->workspace);
    $p2 = $this->createProject('p2', $this->workspace);
    $this->closeTickets($p1, NULL, 2);
    $this->closeTickets($p2, NULL, 3);

    self::assertSame(5, $this->closed([]));
    self::assertSame(2, $this->closed(['project' => [$p1->uuid()]]));
  }

  /**
   * Project and team filters intersect.
   */
  public function testProjectAndTeamFiltersIntersect(): void {
    $team = $this->createTeam('crew', $this->workspace);
    $p1 = $this->createProject('p1', $this->workspace);
    $p2 = $this->createProject('p2', $this->workspace, [$team]);
    $this->closeTickets($p1, NULL, 2);
    $this->closeTickets($p2, NULL, 3);

    self::assertSame(3, $this->closed(['team' => [$team->uuid()]]));
    self::assertSame(0, $this->closed(['project' => [$p1->uuid()], 'team' => [$team->uuid()]]));
  }

  /**
   * The unassigned sentinel selects tickets without an assignee.
   */
  public function testUnassignedSentinelSelectsTicketsWithoutAssignee(): void {
    $project = $this->createProject('p1', $this->workspace);
    $alice = $this->member('alice');
    $bob = $this->member('bob');
    $this->closeTickets($project, NULL, 2);
    $this->closeTickets($project, $alice, 1);
    $this->closeTickets($project, $bob, 1);

    self::assertSame(2, $this->closed(['user' => ['_unassigned']]));
    self::assertSame(3, $this->closed(['user' => ['_unassigned', $alice->uuid()]]));
  }

  /**
   * A person who left the workspace still filters their assigned tickets.
   */
  public function testFormerMemberWithAssignedTicketsIsAcceptedAsPersonFilter(): void {
    $project = $this->createProject('p1', $this->workspace);
    $former = $this->createAccount('former');
    $this->closeTickets($project, $former, 1);
    $this->closeTickets($project, NULL, 2);

    self::assertSame(1, $this->closed(['user' => [$former->uuid()]]));

    $this->expectException(\InvalidArgumentException::class);
    $this->closed(['user' => [$this->createAccount('stranger')->uuid()]]);
  }

  /**
   * An entity of another workspace is rejected, never used to widen.
   */
  public function testForeignFilterEntityIsRejected(): void {
    $foreign = $this->createProject('south', $this->createWorkspace('south'));
    $this->closeTickets($foreign, NULL, 1);

    $this->expectException(\InvalidArgumentException::class);
    $this->closed(['project' => [$foreign->uuid()]]);
  }

  /**
   * The comparison period is narrowed by the same filters.
   */
  public function testComparisonPeriodHonoursFilters(): void {
    $p1 = $this->createProject('p1', $this->workspace);
    $p2 = $this->createProject('p2', $this->workspace);
    $previousMonth = self::NOW - 31 * self::DAY;
    $this->closeTickets($p1, NULL, 1, $previousMonth);
    $this->closeTickets($p2, NULL, 2, $previousMonth);

    $payload = $this->evaluate(['project' => [$p1->uuid()]]);
    self::assertSame(1, $payload['measurements'][0]['comparison']['values']['total']);
  }

  /**
   * The payload names the selection by UUID and carries no entity objects.
   */
  public function testPayloadListsSelectedUuids(): void {
    $p1 = $this->createProject('p1', $this->workspace);
    $payload = $this->evaluate(['project' => [$p1->uuid()]]);

    self::assertSame([$p1->uuid()], $payload['filters']['project']['value']);
    self::assertSame([], $payload['filters']['team']['value']);
    self::assertNotFalse(json_encode($payload));
    self::assertArrayNotHasKey('entities', $payload['filters']['project']);
  }

  /**
   * Evaluates the test figure for the workspace.
   *
   * @param array<string, string|list<string>> $filters
   *   The selected filters.
   *
   * @return array<string, mixed>
   *   The payload.
   */
  private function evaluate(array $filters): array {
    $evaluator = $this->container->get('bb_core.figure_evaluator');
    self::assertInstanceOf(FigureEvaluator::class, $evaluator);
    return $evaluator->evaluate(BbFigure::load('filtered_closed'), ['workspace' => $this->workspace], $filters, self::NOW)->toArray();
  }

  /**
   * The closed-ticket total for a selection.
   *
   * @param array<string, string|list<string>> $filters
   *   The selected filters.
   */
  private function closed(array $filters): int {
    return $this->evaluate($filters)['measurements'][0]['values']['total'];
  }

  /**
   * Creates a workspace member.
   */
  private function member(string $name): UserInterface {
    $account = $this->createAccount($name);
    $this->addMembership($this->workspace, $account, ['member']);
    return $account;
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
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->create(['name' => $name, 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    return $team;
  }

  /**
   * Creates and saves a project in a workspace.
   *
   * @param string $name
   *   The project name.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param array<BbTeamInterface> $teams
   *   The assigned teams.
   */
  private function createProject(string $name, BbWorkspaceInterface $workspace, array $teams = []): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create([
      'name' => $name,
      'group_id' => $group->id(),
      'teams' => array_map(static fn(BbTeamInterface $team): int => (int) $team->id(), $teams),
    ]);
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
   * Creates closed tickets in a project.
   */
  private function closeTickets(BbProjectInterface $project, ?UserInterface $assignee, int $count, int $closed = self::NOW - self::DAY): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    for ($i = 0; $i < $count; $i++) {
      $storage->create([
        'workflow' => 'bb_work',
        'title' => 'filtered-' . mt_rand(),
        'project_id' => $project->id(),
        'assignee_user_id' => $assignee?->id(),
        'created' => $closed,
        'closed' => TRUE,
        'closed_date' => $closed,
      ])->save();
    }
  }

}
