<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_activity\Activity\EntityDetailActivities;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Detail pages list the activities of their own ticket scope.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class EntityDetailActivitiesTest extends KernelTestBase {

  use ActivityKindTestTrait;

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core', 'bb_activity', 'bb_property_access_test',
  ];

  /**
   * Fixture entities keyed by role.
   *
   * @var array<string, \Drupal\Core\Entity\ContentEntityInterface>
   */
  private array $fixture = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_machine', 'bb_conductor', 'bb_ticket',
      'bb_activity', 'bb_notification_setting', 'bb_run', 'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);

    $group = $this->entity('bb_group', ['name' => 'Group']);
    $team = $this->entity('bb_team', ['name' => 'Team']);
    $project = $this->entity('bb_project', [
      'name' => 'Project',
      'key' => 'DET',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $other = $this->entity('bb_project', ['name' => 'Other', 'key' => 'OTD']);
    $machine_a = $this->entity('bb_machine', ['name' => 'Machine A', 'host_key' => 'host-a']);
    $machine_b = $this->entity('bb_machine', ['name' => 'Machine B', 'host_key' => 'host-b']);
    $this->fixture = [
      'group' => $group,
      'team' => $team,
      'project' => $project,
      'other' => $other,
      'machine_a' => $machine_a,
      'machine_b' => $machine_b,
      'conductor_a' => $this->conductor('conductor-a', $machine_a->id()),
      'conductor_b' => $this->conductor('conductor-b', $machine_b->id()),
    ];
  }

  /**
   * Two runs on two machines stay on their own machine and conductor.
   *
   * The ticket's later assignment to conductor B must not pull run A's
   * activities into B's feeds, and an event without a run enters neither.
   * Run A's claim and the status change that closed it reach A's feeds; run
   * B's failure reaches B's.
   */
  public function testRunActivitiesFollowTheirRunNotTheTicketAssignment(): void {
    $ticket = $this->ticket('Two runs', $this->fixture['project']->id());
    $created = $this->latestActivity();
    $status = $this->transition($ticket, 'qualify');
    $claim_a = $this->claim($ticket, $this->fixture['conductor_a']);
    $closed_a = $this->transition($ticket, 'to_coding');
    $failed_b = $this->endRun($ticket, $this->fixture['conductor_b'], 'failed');
    $ticket->set('conductor_id', $this->fixture['conductor_b']->id());
    $ticket->save();
    // The conductor's owner became the assignee: an activity of the ticket,
    // with no run behind it.
    $assigned = $this->latestActivity();

    self::assertSame([$closed_a, $claim_a], $this->ids('conductor_a'));
    self::assertSame([$closed_a, $claim_a], $this->ids('machine_a'));
    self::assertSame([$failed_b], $this->ids('conductor_b'));
    self::assertSame([$failed_b], $this->ids('machine_b'));
    foreach (['project', 'team', 'group'] as $scope) {
      self::assertSame([$assigned, $failed_b, $closed_a, $claim_a, $status, $created], $this->ids($scope), $scope);
    }
  }

  /**
   * Team and group reach tickets through the project, not a ticket field.
   */
  public function testTeamAndGroupScopeIsTheirProjectsTickets(): void {
    $here = $this->ticket('Here', $this->fixture['project']->id());
    $here_created = $this->latestActivity();
    $here_status = $this->transition($here, 'qualify');
    $away = $this->ticket('Away', $this->fixture['other']->id());
    $this->transition($away, 'qualify');

    self::assertSame([$here_status, $here_created], $this->ids('team'));
    self::assertSame([$here_status, $here_created], $this->ids('group'));
    self::assertSame([$here_status, $here_created], $this->ids('project'));
  }

  /**
   * A run whose conductor is gone qualifies for no conductor or machine.
   */
  public function testMissingRunChainIsNotAttributed(): void {
    $ticket = $this->ticket('Orphan', $this->fixture['project']->id());
    $created = $this->latestActivity();
    $claim = $this->claim($ticket, $this->fixture['conductor_a']);
    $this->fixture['conductor_a']->delete();

    self::assertSame([], $this->ids('machine_a'));
    self::assertSame([$claim, $created], $this->ids('project'));
  }

  /**
   * The feed is the newest rows of the scope, capped.
   */
  public function testFeedIsTheNewestCappedRows(): void {
    $rows = [];
    for ($i = 0; $i < EntityDetailActivities::LIMIT; $i++) {
      $ticket = $this->ticket('Row ' . $i, $this->fixture['project']->id());
      $rows[] = $this->latestActivity();
      $rows[] = $this->transition($ticket, 'qualify');
    }

    self::assertSame(array_slice(array_reverse($rows), 0, EntityDetailActivities::LIMIT), $this->ids('team'));
  }

  /**
   * Newer rows refused one by one do not shorten the feed of readable rows.
   */
  public function testRefusedNewerRowsAreReplacedByOlderReadableOnes(): void {
    $ticket = $this->ticket('Many runs', $this->fixture['project']->id());
    $readable = [];
    for ($i = 0; $i < EntityDetailActivities::LIMIT; $i++) {
      $readable[] = $this->endRun($ticket, $this->fixture['conductor_a'], 'failed');
    }
    $denied = [];
    for ($i = 0; $i < 55; $i++) {
      $this->endRun($ticket, $this->fixture['conductor_a'], 'expired');
      $denied[] = $this->latestRun();
    }
    $this->container->get('state')->set('bb_property_access_test.denied_runs', $denied);

    self::assertSame(array_reverse($readable), $this->ids('conductor_a'));
  }

  /**
   * A reader who cannot see the tickets gets an empty feed.
   */
  public function testOutsiderGetsNoActivities(): void {
    $ticket = $this->ticket('Secret', $this->fixture['project']->id());
    $this->transition($ticket, 'qualify');
    $this->claim($ticket, $this->fixture['conductor_a']);
    $outsider = $this->createUser([], 'detail-nobody');
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);

    foreach (['project', 'team', 'group', 'conductor_a', 'machine_a'] as $scope) {
      self::assertSame([], $this->ids($scope), $scope);
    }
  }

  /**
   * Unsupported entities are a programming error.
   */
  public function testUnsupportedEntityIsRejected(): void {
    $this->expectException(\InvalidArgumentException::class);
    $this->service()->activities($this->ticket('Not a detail', $this->fixture['project']->id()));
  }

  /**
   * Activity ids of one fixture's feed, in feed order.
   *
   * @return list<int>
   *   Activity ids.
   */
  private function ids(string $fixture): array {
    $this->resetAccess();
    return array_map(
      static fn (BbActivity $activity): int => (int) $activity->id(),
      $this->service()->activities($this->fixture[$fixture]),
    );
  }

  /**
   * Applies a transition and returns the status activity it recorded.
   */
  private function transition(BbTicketInterface $ticket, string $transition): int {
    $ticket->getState()->applyTransitionById($transition);
    $ticket->save();
    return $this->latestActivity();
  }

  /**
   * Records a claim through a fresh run of the conductor.
   */
  private function claim(BbTicketInterface $ticket, ContentEntityInterface $conductor): int {
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $run = $this->entity('bb_run', [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => 1,
      'state' => 'claimed',
      'state_at_start' => 'spec',
    ]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    $this->claimed($ticket, $run, $conductor);
    return $this->latestActivity();
  }

  /**
   * Ends a fresh run of the conductor without changing the ticket.
   */
  private function endRun(BbTicketInterface $ticket, ContentEntityInterface $conductor, string $outcome): int {
    $run = $this->entity('bb_run', [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => 1,
      'state' => 'claimed',
      'state_at_start' => (string) $ticket->get('state')->value,
    ]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    $run->setRunState($outcome)->save();
    return $this->latestActivity();
  }

  /**
   * The newest activity id.
   */
  private function latestActivity(): int {
    $ids = $this->container->get('entity_type.manager')->getStorage('bb_activity')
      ->getQuery()->accessCheck(FALSE)->sort('id', 'DESC')->range(0, 1)->execute();
    return (int) reset($ids);
  }

  /**
   * The newest run id.
   */
  private function latestRun(): int {
    $ids = $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->getQuery()->accessCheck(FALSE)->sort('id', 'DESC')->range(0, 1)->execute();
    return (int) reset($ids);
  }

  /**
   * A feature ticket in a project.
   */
  private function ticket(string $title, int|string|null $project_id): BbTicketInterface {
    $ticket = $this->entity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_feature',
      'project_id' => $project_id,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * A conductor bound to one machine.
   */
  private function conductor(string $id, int|string|null $machine_id): ContentEntityInterface {
    return $this->entity('bb_conductor', [
      'conductor_id' => $id,
      'label' => $id,
      'owner_user_id' => 1,
      'status' => 'online',
      'project_id' => NULL,
      'machine' => $machine_id,
      'states' => ['spec'],
    ]);
  }

  /**
   * Creates and saves an entity.
   *
   * @param string $type
   *   Entity type id.
   * @param array<string, mixed> $values
   *   Field values.
   */
  private function entity(string $type, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Drops cached access results after a user switch.
   */
  private function resetAccess(): void {
    foreach (['bb_activity', 'bb_ticket', 'bb_run', 'bb_conductor', 'bb_machine'] as $type) {
      $this->container->get('entity_type.manager')->getAccessControlHandler($type)->resetCache();
    }
  }

  /**
   * The service under test.
   */
  private function service(): EntityDetailActivities {
    return $this->container->get(EntityDetailActivities::class);
  }

}
