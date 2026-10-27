<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\InsightsFilterOptions;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the options behind the Insights Project, Team and Person filters.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class InsightsFilterOptionsTest extends KernelTestBase {

  use EpicTermTrait;

  use OgScopeFixtureTrait;
  use InsightsFixtureTrait;

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
   * The workspace whose options are listed.
   */
  private BbWorkspaceInterface $north;

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
    $this->north = $this->workspace('North');
  }

  /**
   * Projects of the workspace come in name order with their closed count.
   */
  public function testProjectOptionsListWorkspaceProjectsWithClosedCounts(): void {
    $pfiff = $this->project('pfiff');
    $atlas = $this->project('atlas');
    $this->project('south', $this->workspace('South'));
    $this->close($atlas, NULL, 3);
    $this->close($pfiff, NULL, 1);

    self::assertSame([
      ['value' => $atlas->uuid(), 'label' => 'atlas', 'count' => 3],
      ['value' => $pfiff->uuid(), 'label' => 'pfiff', 'count' => 1],
    ], $this->options()->projects($this->north, []));
  }

  /**
   * A user's options are the projects of their closed tickets or runs.
   */
  public function testUserProjectOptionsAreMine(): void {
    $alice = $this->account('Alice');
    $atlas = $this->project('atlas');
    $zeta = $this->project('zeta');
    $this->project('idle');
    $this->close($atlas, $alice, 2);
    $this->close($this->project('pfiff'), $this->account('Bob'), 3);
    $now = $this->container->get('datetime.time')->getRequestTime();
    $storage = $this->container->get('entity_type.manager');
    $open = $storage->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'open',
      'project_id' => $zeta->id(),
      'assignee_user_id' => $alice->id(),
      'created' => $now - 60,
    ]);
    $open->save();
    $storage->getStorage('bb_run')->create([
      'ticket_id' => $open->id(),
      'state' => 'running',
      'state_at_start' => 'working',
      'created' => $now - 60,
    ])->save();

    self::assertSame([
      ['value' => $atlas->uuid(), 'label' => 'atlas', 'count' => 2],
      ['value' => $zeta->uuid(), 'label' => 'zeta', 'count' => 0],
    ], $this->options()->projects($alice, []));
  }

  /**
   * People are grouped by team; Other holds unassigned and former members.
   */
  public function testPeopleGroupedByTeamWithOtherUnassigned(): void {
    $crew = $this->team('Platform crew');
    $alice = $this->member('Alice');
    $this->addMembership($crew, $alice, ['member']);
    $bob = $this->member('Bob');
    $former = $this->account('Former');
    $atlas = $this->project('atlas');
    $this->close($atlas, $alice, 2);
    $this->close($atlas, $former, 1);
    $this->close($atlas, NULL, 4);

    $groups = $this->options()->people($this->north, []);
    self::assertSame(['Platform crew', 'Other'], array_column($groups, 'team'));
    $keys = array_flip(['value', 'label', 'count']);
    $first = array_map(static fn(array $entry): array => array_intersect_key($entry, $keys), $groups[0]['entries']);
    self::assertSame([['value' => $alice->uuid(), 'label' => 'Alice', 'count' => 2]], $first);
    self::assertSame(
      ['_unassigned' => 4, $bob->uuid() => 0, $former->uuid() => 1],
      array_column($groups[1]['entries'], 'count', 'value'),
    );
    self::assertSame('Unassigned tickets', $groups[1]['entries'][0]['label']);
  }

  /**
   * Counts follow the period but ignore the selected entity filters.
   */
  public function testCountsIgnoreActiveFilters(): void {
    $atlas = $this->project('atlas');
    $pfiff = $this->project('pfiff');
    $this->close($atlas, NULL, 2);
    $this->close($pfiff, NULL, 5);

    $counts = array_column($this->options()->projects($this->north, ['project' => [$atlas->uuid()]]), 'count', 'label');
    self::assertSame(['atlas' => 2, 'pfiff' => 5], $counts);
  }

  /**
   * All time counts from the workspace's earliest ticket, not from today.
   */
  public function testAllTimeCountsReachTheEarliestTicket(): void {
    $atlas = $this->project('atlas');
    $this->close($atlas, NULL, 1);
    $this->close($atlas, NULL, 1, 400 * 86400);

    self::assertSame(['atlas' => 2], array_column($this->options()->projects($this->north, ['period' => 'all']), 'count', 'label'));
  }

  /**
   * Teams of the workspace with the tickets closed in their projects.
   */
  public function testTeamOptionsCountTheirProjectsTickets(): void {
    $crew = $this->team('Design crew');
    $this->team('Empty crew');
    $atlas = $this->project('atlas', NULL, [$crew]);
    $this->close($atlas, NULL, 3);

    self::assertSame(['Design crew' => 3, 'Empty crew' => 0], array_column($this->options()->teams($this->north, []), 'count', 'label'));
  }

  /**
   * A project offers its own epics, counting each epic's closed subtree.
   */
  public function testEpicOptionsListOnlyTheProjectsEpics(): void {
    $lead = $this->member('Lead');
    $this->addMembership($this->north, $lead, ['lead']);
    $this->container->get('current_user')->setAccount($lead);
    $atlas = $this->project('atlas');
    $pfiff = $this->project('pfiff');
    $epic = $this->ticket($atlas, 'epic', 'Checkout', NULL);
    $this->ticket($atlas, 'bb_work', 'Cart', $epic, TRUE);
    $this->ticket($atlas, 'bb_work', 'Loose', NULL, TRUE);
    $this->ticket($pfiff, 'epic', 'Foreign', NULL);

    self::assertSame(
      [['value' => $epic->uuid(), 'label' => 'Checkout', 'count' => 1]],
      $this->options()->epics($atlas, []),
    );
  }

  /**
   * A project offers the assignees of its tickets, never other members.
   */
  public function testProjectPeopleAreItsAssignees(): void {
    $alice = $this->member('Alice');
    $bob = $this->member('Bob');
    $atlas = $this->project('atlas');
    $pfiff = $this->project('pfiff');
    $this->close($atlas, $alice, 1);
    $this->close($pfiff, $bob, 1);
    $carol = $this->account('Carol');
    $this->ticket($atlas, 'bb_work', 'Open', NULL, FALSE, $carol);

    $entries = array_merge(...array_column($this->options()->people($atlas, []), 'entries'));
    self::assertSame(
      ['_unassigned' => 0, $alice->uuid() => 1, $carol->uuid() => 0],
      array_column($entries, 'count', 'value'),
    );
  }

  /**
   * Creates a ticket, closed this month when asked.
   */
  private function ticket(BbProjectInterface $project, string $workflow, string $title, ?BbTicketInterface $parent, bool $closed = FALSE, ?UserInterface $assignee = NULL): BbTicketInterface {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'ticket_type' => $workflow === 'epic' ? $this->epicTerm($project)->id() : NULL,
      'title' => $title,
      'project_id' => $project->id(),
      'parent_id' => $parent?->id(),
      'assignee_user_id' => $assignee?->id(),
      'created' => $now - 120,
      'closed' => $closed,
      'closed_date' => $closed ? $now - 120 : NULL,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The options service.
   */
  private function options(): InsightsFilterOptions {
    $service = $this->container->get('bb_core.insights_filter_options');
    self::assertInstanceOf(InsightsFilterOptions::class, $service);
    return $service;
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
   * Creates a team in the north workspace.
   */
  private function team(string $name): BbTeamInterface {
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->create(['name' => $name, 'workspace_id' => $this->north->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    return $team;
  }

  /**
   * Creates a project, by default in the north workspace.
   *
   * @param string $name
   *   The project name.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|null $workspace
   *   The workspace; north when NULL.
   * @param array<BbTeamInterface> $teams
   *   The project's teams.
   */
  private function project(string $name, ?BbWorkspaceInterface $workspace = NULL, array $teams = []): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')
      ->create(['name' => $name . '-group', 'workspace_id' => ($workspace ?? $this->north)->id()]);
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
   * Creates an account.
   */
  private function account(string $name): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $account);
    $account->save();
    return $account;
  }

  /**
   * Creates a member of the north workspace.
   */
  private function member(string $name): UserInterface {
    $account = $this->account($name);
    $this->addMembership($this->north, $account, ['member']);
    return $account;
  }

  /**
   * Closes tickets in a project, by default this month.
   */
  private function close(BbProjectInterface $project, ?UserInterface $assignee, int $count, int $ago = 60): void {
    $now = $this->container->get('datetime.time')->getRequestTime() - $ago + 60;
    for ($i = 0; $i < $count; $i++) {
      $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
        'workflow' => 'bb_work',
        'title' => 'closed-' . $i,
        'project_id' => $project->id(),
        'assignee_user_id' => $assignee?->id(),
        'created' => $now - 60,
        'closed' => TRUE,
        'closed_date' => $now - 60,
      ])->save();
    }
  }

}
