<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Database\Database;
use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Project\AttentionItem;
use Drupal\bb_core\Project\ProjectHealth;
use Drupal\og\Og;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the shared project health: the attention set and the work counts.
 *
 * A viewer who is a member of the project's team reads the project; the
 * conductor and its owner come from the claim fixture.
 */
#[Group('bb_core')]
final class ProjectHealthTest extends ClaimKernelTestBase {

  private const DAY = 86400;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'filter', 'search_api', 'search_api_db',
    'bb_core', 'bb_activity',
  ];

  /**
   * The service under test.
   */
  private ProjectHealth $health;

  /**
   * The project the claim fixture's conductor works in.
   */
  private BbProjectInterface $project;

  /**
   * The account that reads the health.
   */
  private UserInterface $viewer;

  /**
   * Label terms by name.
   *
   * @var array<string, int>
   */
  private array $labels = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_activity');
    $project = $this->conductor->get('project_id')->entity;
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
    $this->viewer = $this->createViewer('health-viewer', [$this->project]);
    $this->container->get('current_user')->setAccount($this->viewer);
    $this->health = $this->container->get('bb_core.project_health');
  }

  /**
   * Each condition gives its severity and reason.
   */
  #[DataProvider('reasonCases')]
  public function testReasonPerCondition(string $case, string $severity, string $reason): void {
    $ticket = $this->seedAssignedTicket('working');
    switch ($case) {
      case 'technical problem':
      case 'Question':
        $this->label($ticket, $case);
        break;

      case 'no access':
        $this->revokeConductorOwner();
        break;

      case 'failed':
      case 'expired':
        $this->seedRun($ticket, 'working', $case);
        break;

      case 'idle':
        $this->setMovement($ticket, 4 * self::DAY);
        break;
    }
    $items = $this->health->attention($this->project);
    self::assertCount(1, $items);
    self::assertInstanceOf(AttentionItem::class, $items[0]);
    self::assertSame((int) $ticket->id(), (int) $items[0]->ticket->id());
    self::assertSame([$severity, $reason], [$items[0]->severity, $items[0]->reason]);
    self::assertSame($case === 'idle' ? 4 : NULL, $items[0]->idleDays);
  }

  /**
   * One case per reason of the spec's table.
   *
   * @return array<string, array{string, string, string}>
   *   Scenario, severity and reason text.
   */
  public static function reasonCases(): array {
    return [
      'technical problem' => ['technical problem', 'red', 'Technical problem'],
      'no access' => ['no access', 'red', 'Conductor has no access'],
      'failed' => ['failed', 'red', 'Last run failed'],
      'expired' => ['expired', 'red', 'Last run expired'],
      'question' => ['Question', 'yellow', 'Needs info'],
      'idle' => ['idle', 'yellow', 'Idle 4 days'],
    ];
  }

  /**
   * Tickets that need no person stay out of the set.
   */
  public function testNoReasonCases(): void {
    $idle_working = $this->seedAssignedTicket('working');
    $this->setMovement($idle_working, 2 * self::DAY);

    $idle_intake = $this->seedAssignedTicket('qualification');
    $this->setMovement($idle_intake, 10 * self::DAY);

    $recovered = $this->seedAssignedTicket('working');
    $this->seedRun($recovered, 'working', 'failed');
    $this->seedRun($recovered, 'working', 'running');

    $closed = $this->seedAssignedTicket('working');
    $this->seedRun($closed, 'working', 'failed');
    $closed->set('closed', TRUE)->save();

    $blocked = $this->seedBlocked($this->seedAssignedTicket('working'), 'open');
    $this->label($blocked, 'technical problem');

    self::assertSame([], $this->health->unhealthyIds($this->project));

    $done_blocker = $this->seedBlocked($this->seedAssignedTicket('working'), 'done');
    $this->seedRun($done_blocker, 'working', 'failed');
    $ids = $this->health->unhealthyIds($this->project);
    self::assertSame([(int) $done_blocker->id()], $ids);
  }

  /**
   * The first matching reason of the table wins.
   */
  public function testFirstMatchingReasonWins(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->label($ticket, 'technical problem');
    $this->seedRun($ticket, 'working', 'failed');
    $items = $this->health->attention($this->project);
    self::assertCount(1, $items);
    self::assertSame('Technical problem', $items[0]->reason);
  }

  /**
   * Red before yellow, then priority, then oldest movement.
   */
  public function testOrder(): void {
    $yellow_p1 = $this->seedAssignedTicket('working');
    $this->label($yellow_p1, 'Question');
    $red_p3 = $this->seedAssignedTicket('working');
    $this->label($red_p3, 'technical problem');
    $red_p1_older = $this->seedAssignedTicket('working');
    $this->label($red_p1_older, 'technical problem');
    $red_p1_newer = $this->seedAssignedTicket('working');
    $this->label($red_p1_newer, 'technical problem');
    $priorities = [[$yellow_p1, 1], [$red_p3, 3], [$red_p1_older, 1], [$red_p1_newer, 1]];
    foreach ($priorities as [$ticket, $priority]) {
      $ticket->set('priority', $priority)->save();
    }
    $this->setMovement($red_p1_older, 5 * self::DAY);
    $this->setMovement($red_p1_newer, 1 * self::DAY);
    $this->setMovement($red_p3, 9 * self::DAY);
    $this->setMovement($yellow_p1, 9 * self::DAY);

    $expected = [$red_p1_older, $red_p1_newer, $red_p3, $yellow_p1];
    self::assertSame(
      array_map(static fn (BbTicketInterface $ticket): int => (int) $ticket->id(), $expected),
      $this->health->unhealthyIds($this->project),
    );
  }

  /**
   * Movement falls back to the newest run, then to the ticket's creation.
   */
  public function testMovementFallsBackToRunThenCreated(): void {
    $with_run = $this->seedAssignedTicket('working');
    $run = $this->seedRun($with_run, 'working', 'changed');
    $this->setRunChanged($run->id(), 5 * self::DAY);
    $this->setMovement($with_run, NULL);

    $bare = $this->seedAssignedTicket('working');
    $this->setMovement($bare, NULL);
    $this->container->get('database')->update('bb_ticket')
      ->fields(['created' => $this->now() - 6 * self::DAY])
      ->condition('id', $bare->id())
      ->execute();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->resetCache();

    $days = [];
    foreach ($this->health->attention($this->project) as $item) {
      $days[(int) $item->ticket->id()] = [$item->reason, $item->idleDays];
    }
    self::assertSame(['Idle 5 days', 5], $days[(int) $with_run->id()]);
    self::assertSame(['Idle 6 days', 6], $days[(int) $bare->id()]);
  }

  /**
   * Only this project's tickets the account may view count.
   */
  public function testOnlyThisProjectsViewableTickets(): void {
    $mine = $this->seedAssignedTicket('working');
    $this->label($mine, 'technical problem');

    $other = $this->createProject('health-other');
    $hidden = $this->createProject('health-hidden');
    $this->container->get('current_user')->setAccount($this->createViewer('health-two', [$this->project, $other]));
    $elsewhere = $this->seedTicketIn($other);
    $this->label($elsewhere, 'technical problem');
    $unviewable = $this->seedTicketIn($hidden);
    $this->label($unviewable, 'technical problem');

    $ids = $this->health->unhealthyIds($this->project);
    self::assertSame([(int) $mine->id()], $ids);
    self::assertSame(
      $ids,
      array_map(static fn (AttentionItem $item): int => (int) $item->ticket->id(), $this->health->attention($this->project)),
    );
    self::assertSame([], $this->health->unhealthyIds($hidden), 'A project the account cannot read has no attention set for it.');
  }

  /**
   * The tiles read the index the Board reads.
   */
  public function testWorkStateCounts(): void {
    $this->installIndex();
    for ($i = 0; $i < 2; $i++) {
      $this->seedAssignedTicket('qualification');
    }
    for ($i = 0; $i < 3; $i++) {
      $this->seedAssignedTicket('working');
    }
    $this->seedTicketIn($this->project);
    $this->seedAssignedTicket('working')->set('closed', TRUE)->save();
    $other = $this->createProject('health-counts-other');
    $this->container->get('current_user')->setAccount($this->createViewer('health-counts', [$this->project, $other]));
    $this->seedTicketIn($other, TRUE);
    $this->container->get('entity_type.manager')->getStorage('search_api_index')->load('bb_tickets')->indexItems();

    self::assertSame(['intake' => 2, 'working' => 3], $this->health->workStateCounts($this->project));
  }

  /**
   * A running run is always live; a claimed one only with a live lease.
   */
  public function testLiveRunRule(): void {
    $deriver = $this->container->get('bb_core.ticket_run_deriver');
    self::assertInstanceOf(TicketRunDeriver::class, $deriver);
    $past = $this->now() - 60;

    $running = $this->seedAssignedTicket('working');
    $this->seedRun($running, 'working', 'running', $past);
    $open_lease = $this->seedAssignedTicket('working');
    $this->seedRun($open_lease, 'working', 'claimed', 0);
    $lapsed = $this->seedAssignedTicket('working');
    $this->seedRun($lapsed, 'working', 'claimed', $past);
    $idle = $this->seedAssignedTicket('working');

    self::assertTrue($deriver->hasLiveRun($running));
    self::assertTrue($deriver->hasLiveRun($open_lease));
    self::assertFalse($deriver->hasLiveRun($lapsed));
    self::assertFalse($deriver->hasLiveRun($idle));

    $all = [$running, $open_lease, $lapsed, $idle];
    $ids = $deriver->liveRunTicketIds(array_map(static fn (BbTicketInterface $ticket): int => (int) $ticket->id(), $all));
    sort($ids);
    self::assertSame([(int) $running->id(), (int) $open_lease->id()], $ids);
    self::assertSame([], $deriver->liveRunTicketIds([]));
  }

  /**
   * The newest run of each ticket gives its state.
   */
  public function testLatestRunStates(): void {
    $deriver = $this->container->get('bb_core.ticket_run_deriver');
    $first = $this->seedAssignedTicket('working');
    $this->seedRun($first, 'working', 'failed');
    $this->seedRun($first, 'working', 'done');
    $second = $this->seedAssignedTicket('working');
    $this->seedRun($second, 'working', 'done');
    $this->seedRun($second, 'working', 'expired');
    $none = $this->seedAssignedTicket('working');

    self::assertSame(
      [(int) $first->id() => 'done', (int) $second->id() => 'expired'],
      $deriver->latestRunStates([(int) $first->id(), (int) $second->id(), (int) $none->id()]),
    );
    self::assertSame([], $deriver->latestRunStates([]));
  }

  /**
   * A project of 40 open tickets costs the queries of one of 5.
   */
  public function testConstantQueryCount(): void {
    for ($i = 0; $i < 5; $i++) {
      $this->seedHealthyTicket();
    }
    $small = $this->countRunAndActivityQueries('small');
    for ($i = 0; $i < 35; $i++) {
      $this->seedHealthyTicket();
    }
    $large = $this->countRunAndActivityQueries('large');

    self::assertGreaterThan(0, $small);
    self::assertSame($small, $large);
  }

  /**
   * A frozen ticket without a label is a deliberate hold, not a problem.
   */
  public function testFrozenWithoutLabelIsNotUnhealthy(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'done');
    $ticket->setFrozen(TRUE)->save();
    self::assertSame([], $this->health->unhealthyIds($this->project));
  }

  /**
   * Seeds a working ticket with a run, so every batch query has rows.
   */
  private function seedHealthyTicket(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'done');
  }

  /**
   * Counts the attention queries that touch runs or activities.
   */
  private function countRunAndActivityQueries(string $key): int {
    Database::startLog($key);
    $this->health->attention($this->project);
    $count = 0;
    foreach (Database::getLog($key) as $entry) {
      if (preg_match('/\b(bb_run|bb_activity)\b/', (string) $entry['query'])) {
        $count++;
      }
    }
    return $count;
  }

  /**
   * The request time the service reads.
   */
  private function now(): int {
    return $this->container->get('datetime.time')->getRequestTime();
  }

  /**
   * Puts a label of the given name on the ticket.
   */
  private function label(BbTicketInterface $ticket, string $name): void {
    if (!isset($this->labels[$name])) {
      $term = $this->container->get('entity_type.manager')->getStorage('bb_term')->create([
        'vid' => 'label',
        'name' => $name,
        'workspace_id' => $this->project->get('group_id')->entity->get('workspace_id')->target_id,
      ]);
      $term->save();
      $this->labels[$name] = (int) $term->id();
    }
    $ticket->set('labels', [$this->labels[$name]])->save();
  }

  /**
   * Sets when the ticket last moved: one activity row, or none with NULL.
   *
   * Saving a ticket records activity of its own, so this runs after the
   * ticket's last save.
   */
  private function setMovement(BbTicketInterface $ticket, ?int $age): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $storage->delete($storage->loadByProperties(['ticket_id' => $ticket->id()]));
    if ($age !== NULL) {
      $storage->create([
        'ticket_id' => $ticket->id(),
        'kind' => 'test',
        'created' => $this->now() - $age,
      ])->save();
    }
  }

  /**
   * Ages a run's last change.
   */
  private function setRunChanged(int|string|null $id, int $age): void {
    $this->container->get('database')->update('bb_run')
      ->fields(['changed' => $this->now() - $age])
      ->condition('id', $id)
      ->execute();
  }

  /**
   * Blocks a ticket by a new working ticket that is open or done.
   */
  private function seedBlocked(BbTicketInterface $ticket, string $blocker_state): BbTicketInterface {
    $blocker = $this->seedAssignedTicket('working');
    if ($blocker_state === 'done') {
      $this->container->get('database')->update('bb_ticket')
        ->fields(['state' => 'done'])
        ->condition('id', $blocker->id())
        ->execute();
      $this->container->get('entity_type.manager')->getStorage('bb_ticket')->resetCache();
    }
    $ticket->set('blocked_by', [$blocker->id()])->save();
    return $ticket;
  }

  /**
   * Takes the conductor owner's access to the project away.
   */
  private function revokeConductorOwner(): void {
    $owner = $this->conductor->get('owner_user_id')->entity;
    foreach (Og::getMemberships($owner) as $membership) {
      $membership->delete();
    }
    $this->container->get('cache.static')->deleteAll();
    $this->container->get('bb_core.workspace_read_scope')->reset();
  }

  /**
   * Creates a project of its own workspace chain's group and a fresh team.
   */
  private function createProject(string $name): BbProjectInterface {
    $etm = $this->container->get('entity_type.manager');
    $group = $this->project->get('group_id')->entity;
    $team = $etm->getStorage('bb_team')->create([
      'name' => $name . ' team',
      'workspace_id' => $group->get('workspace_id')->target_id,
    ]);
    $team->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => $name,
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    return $project;
  }

  /**
   * Creates a viewer who reads the given projects through their teams.
   *
   * @param string $name
   *   The account name.
   * @param list<\Drupal\bb_core\Entity\BbProjectInterface> $projects
   *   The projects it is a team member of.
   */
  private function createViewer(string $name, array $projects): UserInterface {
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'r_' . $name, 'label' => $name])->save();
    user_role_grant_permissions('r_' . $name, ['view bb_ticket']);
    $account = $etm->getStorage('user')->create(['name' => $name, 'status' => 1, 'roles' => ['r_' . $name]]);
    $account->save();
    self::assertInstanceOf(UserInterface::class, $account);
    $workspace = $projects[0]->get('group_id')->entity->get('workspace_id')->entity;
    $this->addMembership($workspace, $account, ['member']);
    foreach ($projects as $project) {
      foreach ($project->get('teams')->referencedEntities() as $team) {
        $this->addMembership($team, $account);
      }
    }
    return $account;
  }

  /**
   * Creates a ticket of a project, with a conductor only when asked.
   */
  private function seedTicketIn(BbProjectInterface $project, bool $intake = FALSE): BbTicketInterface {
    $values = [
      'identifier' => 'GL-H-' . mt_rand(),
      'workflow' => 'bb_work',
      'title' => 'Other',
      'project_id' => $project->id(),
    ];
    if ($intake) {
      $values['conductor_id'] = $this->conductor->id();
    }
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create($values);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Installs the ticket index so saved tickets are indexed.
   */
  private function installIndex(): void {
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')->installOptionalConfig(NULL, ['module' => 'bb_core']);
  }

}
