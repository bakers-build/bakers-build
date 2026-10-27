<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Access\FigureDisclosure;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the shipped Project › Stats figures: who sees them, what counts.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectStatsFiguresTest extends KernelTestBase {

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
   * The workspace holding the project.
   */
  private BbWorkspaceInterface $north;

  /**
   * The project under test.
   */
  private BbProjectInterface $project;

  /**
   * The epic E of the project.
   */
  private BbTicketInterface $epic;

  /**
   * The assignee of the epic's child and of one loose ticket.
   */
  private UserInterface $alice;

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
    $this->account('uid1-dummy');
    $this->installInsightsFigures();
    $this->north = $this->workspace('north');
    $this->project = $this->project($this->north, 'atlas');
    $this->alice = $this->account('Alice Baker');
    $bob = $this->account('Bob Miller');
    $this->epic = $this->ticket(NULL, NULL, 'epic', 0);
    $child = $this->ticket($this->epic, $this->alice, 'bb_work', 0);
    $this->ticket($child, $bob, 'bb_work', 100);
    $this->ticket(NULL, $this->alice, 'bb_work', 50);
    $this->ticket(NULL, NULL, 'bb_work', 0);
    // A ticket of another project never counts here.
    $this->ticket(NULL, $this->account('Carol Other'), 'bb_work', 999, $this->project($this->north, 'pfiff'));
  }

  /**
   * Every viewer of the project sees the three figures (D2).
   *
   * A plain member views no project, so its rank grants nothing here.
   */
  public function testEveryProjectViewerSeesTheFigures(): void {
    foreach (['guest', 'contributor', 'lead'] as $rank) {
      $account = $this->account('north-' . $rank);
      $this->addMembership($this->north, $account, [$rank]);
      foreach (self::PROJECT_STATS_FIGURES as $id) {
        self::assertTrue($this->mayView($account, $id), "A $rank sees $id.");
      }
    }
  }

  /**
   * A lead of another workspace sees none of them.
   */
  public function testForeignLeadIsDenied(): void {
    $southLead = $this->account('south-lead');
    $this->addMembership($this->workspace('south'), $southLead, ['lead']);
    foreach (self::PROJECT_STATS_FIGURES as $id) {
      self::assertFalse($this->mayView($southLead, $id), "A foreign lead does not see $id.");
    }
  }

  /**
   * Throughput counts the project, the epic's subtree, then one person in it.
   */
  public function testThroughputFollowsEpicAndPersonFilters(): void {
    self::assertSame(5, $this->tile('closed_tickets', []));
    self::assertSame(150, $this->tile('run_tokens', []));
    $epic = ['epic' => [$this->epic->uuid()]];
    self::assertSame(3, $this->tile('closed_tickets', $epic), 'The epic counts itself and its subtree.');
    self::assertSame(100, $this->tile('run_tokens', $epic), 'Tokens follow their ticket.');
    self::assertSame(1, $this->tile('closed_tickets', $epic + ['user' => [$this->alice->uuid()]]), 'Epic and person combine.');
  }

  /**
   * Rating stays empty while no ticket is rated.
   */
  public function testRatingIsEmptyWithoutRatedTickets(): void {
    self::assertNull($this->measurement('project_overview', 'job_rating', [])['total']);
  }

  /**
   * People rows are the assignees of the project's tickets, by name.
   */
  public function testPeopleRowsAreTheProjectsAssigneesByName(): void {
    $renderer = $this->container->get('bb_core.figure_renderer');
    $widgets = (new \ReflectionMethod($renderer, 'widget'))->invoke($renderer, $this->values('project_people', []), ['project' => $this->project]);
    $names = array_map(static fn(array $row): string => $row['cells']['label']['display_name'], $widgets['table']['#props']['rows']);
    self::assertSame(['Alice Baker', 'Bob Miller', 'Unassigned tickets'], $names);
  }

  /**
   * One tile total of the project overview.
   *
   * @param string $measurement
   *   The measurement ID.
   * @param array<string, list<string>> $filters
   *   The selected filters.
   */
  private function tile(string $measurement, array $filters): int {
    return (int) $this->measurement('project_overview', $measurement, $filters)['total'];
  }

  /**
   * The values of one measurement of a figure.
   *
   * @param string $figureId
   *   The figure ID.
   * @param string $measurement
   *   The measurement ID.
   * @param array<string, list<string>> $filters
   *   The selected filters.
   *
   * @return array<string, mixed>
   *   The values.
   */
  private function measurement(string $figureId, string $measurement, array $filters): array {
    return array_column($this->values($figureId, $filters)['measurements'], 'values', 'id')[$measurement];
  }

  /**
   * Evaluates one shipped figure for the project this month.
   *
   * @param string $figureId
   *   The figure ID.
   * @param array<string, list<string>> $filters
   *   The selected filters.
   *
   * @return array<string, mixed>
   *   The payload.
   */
  private function values(string $figureId, array $filters): array {
    $evaluator = $this->container->get('bb_core.figure_evaluator');
    self::assertInstanceOf(FigureEvaluator::class, $evaluator);
    return $evaluator->evaluate(BbFigure::load($figureId), ['project' => $this->project], $filters, self::NOW)->toArray();
  }

  /**
   * Whether an account may view one shipped figure of the project.
   */
  private function mayView(UserInterface $account, string $figureId): bool {
    $figure = BbFigure::load($figureId);
    self::assertInstanceOf(BbFigureInterface::class, $figure);
    $disclosure = $this->container->get('bb_core.figure_disclosure');
    self::assertInstanceOf(FigureDisclosure::class, $disclosure);
    return $disclosure->mayView($account, $figure, ['project' => $this->project]);
  }

  /**
   * Creates a workspace.
   */
  private function workspace(string $name): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create(['name' => $name]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    return $workspace;
  }

  /**
   * Creates a project in a workspace.
   */
  private function project(BbWorkspaceInterface $workspace, string $name): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create(['name' => $name, 'group_id' => $group->id()]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates an account.
   */
  private function account(string $name): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $account);
    $account->save();
    return $account;
  }

  /**
   * Creates a ticket closed yesterday, with one run when tokens are given.
   */
  private function ticket(?BbTicketInterface $parent, ?UserInterface $assignee, string $workflow, int $tokens, ?BbProjectInterface $project = NULL): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager');
    $ticket = $storage->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'ticket_type' => $workflow === 'epic' ? $this->epicTerm($project ?? $this->project)->id() : NULL,
      'title' => 'stats-' . mt_rand(),
      'project_id' => ($project ?? $this->project)->id(),
      'parent_id' => $parent?->id(),
      'assignee_user_id' => $assignee?->id(),
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
