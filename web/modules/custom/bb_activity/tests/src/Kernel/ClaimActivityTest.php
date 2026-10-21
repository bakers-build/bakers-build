<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the TicketClaimService claim and claimNext logic.
 *
 * Covers lease creation, conflict detection, the states/project eligibility
 * model, the conductor-assignment rule, priority-based ordering, and
 * expired-lease reclamation.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ClaimActivityTest extends KernelTestBase {

  use ActivityKindTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core', 'bb_activity',
  ];

  /**
   * The default project all fixtures belong to unless stated otherwise.
   */
  private int $projectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_activity', 'bb_notification_setting', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createUser('uid1-dummy');
    $this->projectId = $this->createProject('default-project');
  }

  /**
   * Creates and saves a BbProject, returning its entity ID.
   *
   * @param string $name
   *   Project name.
   *
   * @return int
   *   The saved project entity ID.
   */
  private function createProject(string $name): int {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $name]);
    $project->save();
    return (int) $project->id();
  }

  /**
   * Creates a plain Drupal user without special permissions.
   *
   * @param string $name
   *   Username for the new account.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user entity.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a Drupal user with conductor registration and claim permissions.
   *
   * @param string $name
   *   Username for the new account.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user entity.
   */
  private function createConductorUser(string $name): UserInterface {
    $role_id = 'conductor_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, ['register bakers conductor', 'claim bakers tickets']);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a BbConductor registered for a project and states.
   *
   * @param \Drupal\user\UserInterface $owner
   *   The owning user account.
   * @param string $machine_id
   *   Unique machine identifier for the conductor node.
   * @param array $states
   *   Workflow state machine names the conductor handles.
   * @param int|null $project_id
   *   Project entity ID; defaults to the shared test project.
   * @param int|null $last_seen
   *   Heartbeat timestamp; defaults to now (active conductor).
   * @param string $status
   *   Conductor status; defaults to 'online'.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface
   *   The saved conductor entity.
   */
  private function createConductor(
    UserInterface $owner,
    string $machine_id,
    array $states = ['diagnose', 'coding'],
    ?int $project_id = NULL,
    ?int $last_seen = NULL,
    string $status = 'online',
  ): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $machine_id,
      'label' => $machine_id,
      'owner_user_id' => $owner->id(),
      'status' => $status,
      'project_id' => $project_id ?? $this->projectId,
      'states' => $states,
      'last_seen' => $last_seen ?? $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates and saves a BbTicket in its claimable entry state ('diagnose').
   *
   * The bb_bug workflow starts in the 'diagnose' entry state, so a freshly
   * created ticket is immediately claimable without an explicit activation.
   *
   * @param string $identifier
   *   Human-readable ticket identifier.
   * @param array $values
   *   Optional additional field values to merge in.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved, claimable ticket entity.
   */
  private function createActiveTicket(string $identifier, array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create($values + [
        'identifier' => $identifier,
        'workflow' => 'bb_bug',
        'title' => $identifier,
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    // The bb_bug workflow now enters 'qualification' first (BB-196);
    // advance to 'diagnose', the claimable work state the default conductor
    // states cover.
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    return $ticket;
  }

  /**
   * Assigns a ticket to the given conductor and saves it.
   *
   * Conductor assignment (`conductor_id`) is what makes a classified ticket
   * claimable — the user assignee no longer participates in claiming.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to assign.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor the ticket is assigned to.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket entity.
   */
  private function assignToConductor(BbTicketInterface $ticket, BbConductorInterface $conductor): BbTicketInterface {
    $ticket->set('conductor_id', $conductor->id())->save();
    return $ticket;
  }

  /**
   * Returns the TicketClaimService from the service container.
   *
   * @return \Drupal\bb_core\Claim\TicketClaimService
   *   The claim service.
   */
  private function claim(): TicketClaimService {
    return $this->container->get('bb_core.ticket_claim');
  }

  /**
   * Verifies that claiming an eligible ticket creates a run in claimed state.
   *
   * Checks the run state, the recorded state_at_start, and the run lease.
   */
  public function testClaimRecordsOneRowWithRunConductorStepAndActor(): void {
    $owner = $this->createConductorUser('claim-owner');
    $this->container->get('current_user')->setAccount($owner);
    $conductor = $this->createConductor($owner, 'node-c');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-C2'), $conductor);

    $run = $this->claim()->claim($ticket, $conductor, 600);
    $this->assertSame('claimed', $run->getRunState());
    $this->assertSame('diagnose', $run->get('state_at_start')->value);
    $this->assertGreaterThan(
      $this->container->get('datetime.time')->getRequestTime(),
      $run->getClaimExpiresAt(),
    );
    $activities = $this->loadActivities((int) $ticket->id(), 'claimed');
    $this->assertCount(1, $activities);
    $activity = reset($activities);
    $this->assertInstanceOf(BbActivity::class, $activity);
    $this->assertSame((string) $run->id(), (string) $activity->get('run_id')->target_id);
    $this->assertSame((string) $conductor->id(), (string) $activity->get('conductor_id')->target_id);
    $this->assertSame('diagnose', $activity->get('step')->value);
    $this->assertSame((string) $owner->id(), (string) $activity->get('actor')->target_id);
  }

  /**
   * Verifies that a second claim on an already-claimed ticket fails.
   *
   * Expects a ClaimConflictException to be thrown.
   */
  public function testConflictingClaimAddsNoRow(): void {
    $owner = $this->createConductorUser('conflict-owner');
    $conductor_a = $this->createConductor($owner, 'node-d');
    $conductor_b = $this->createConductor($owner, 'node-e');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-C3'), $conductor_a);

    $this->claim()->claim($ticket, $conductor_a, 600);
    $this->assertCount(1, $this->loadActivities((int) $ticket->id(), 'claimed'));
    $this->expectClaimConflict(fn () => $this->claim()->claim($ticket, $conductor_b, 600));
    $this->assertCount(1, $this->loadActivities((int) $ticket->id(), 'claimed'));
  }

  /**
   * A re-claim after an expired lease adds no claim row but shows the expiry.
   */
  public function testExpiredClaimThenReclaimRecordsExpiryNotSecondClaim(): void {
    $owner = $this->createConductorUser('reclaim-activity-owner');
    $conductor = $this->createConductor($owner, 'node-reclaim-activity');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-RECLAIM-ACT'), $conductor);

    $first = $this->claim()->claim($ticket, $conductor, 300);
    $first->set('claim_expires_at', $this->container->get('datetime.time')->getRequestTime() - 1);
    $first->save();
    $this->assertCount(1, $this->loadActivities((int) $ticket->id(), 'claimed'));

    $second = $this->claim()->claim($ticket, $conductor, 300);
    $claims = $this->loadActivities((int) $ticket->id(), 'claimed');
    $this->assertCount(1, $claims);
    $this->assertInstanceOf(BbActivity::class, $claims[0]);
    $this->assertSame((string) $first->id(), (string) $claims[0]->get('run_id')->target_id);
    $ended = $this->loadActivities((int) $ticket->id(), 'run_ended');
    $this->assertCount(1, $ended);
    $this->assertInstanceOf(BbActivity::class, $ended[0]);
    $this->assertSame((string) $first->id(), (string) $ended[0]->get('run_id')->target_id);
    $this->assertNotSame($first->uuid(), $second->uuid());
  }

  /**
   * Heartbeat and run-state updates add no claimed activity.
   */
  public function testHeartbeatAndRunStateUpdateAddNoClaimedActivity(): void {
    $owner = $this->createConductorUser('heartbeat-activity-owner');
    $conductor = $this->createConductor($owner, 'node-heartbeat-activity');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-HB-ACT'), $conductor);

    $run = $this->claim()->claim($ticket, $conductor, 300);
    $this->assertCount(1, $this->loadActivities((int) $ticket->id(), 'claimed'));
    $run->set('heartbeat', $this->container->get('datetime.time')->getRequestTime())->save();
    $run->setRunState('running')->save();
    $this->assertCount(1, $this->loadActivities((int) $ticket->id(), 'claimed'));
  }

  /**
   * A kind failure after the run is minted rolls the claim back.
   */
  public function testKindFailureRollsBackClaim(): void {
    $owner = $this->createConductorUser('failing-kind-owner');
    $conductor = $this->createConductor($owner, 'node-failing-kind');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-FAIL-REC'), $conductor);
    $this->failKinds('claimed');

    $this->expectClaimConflict(fn () => $this->claim()->claim($ticket, $conductor, 300));
    $this->container->get('entity_type.manager')->getStorage('bb_run')->resetCache();
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->resetCache();
    $runs = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadByProperties([
      'ticket_id' => $ticket->id(),
    ]);
    $this->assertCount(0, $runs);
    $this->assertCount(0, $this->loadActivities((int) $ticket->id(), 'claimed'));
  }

  /**
   * An outer rollback after a successful claim removes the run and activity.
   */
  public function testOuterRollbackRemovesClaimAndActivity(): void {
    $owner = $this->createConductorUser('outer-claim-owner');
    $conductor = $this->createConductor($owner, 'node-outer-claim');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-OUTER-CLAIM'), $conductor);

    $transaction = $this->container->get('database')->startTransaction();
    $run = $this->claim()->claim($ticket, $conductor, 300);
    $run_id = $run->id();
    $this->assertCount(1, $this->loadActivities((int) $ticket->id(), 'claimed'));
    $transaction->rollBack();
    unset($transaction);

    $this->container->get('entity_type.manager')->getStorage('bb_run')->resetCache([$run_id]);
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->resetCache();
    $this->assertNull($this->container->get('entity_type.manager')->getStorage('bb_run')->load($run_id));
    $this->assertCount(0, $this->loadActivities((int) $ticket->id(), 'claimed'));
  }

  /**
   * Asserts that the given callback throws a ClaimConflictException.
   *
   * @param callable $callback
   *   The callable expected to throw.
   */
  private function expectClaimConflict(callable $callback): void {
    try {
      $callback();
      $this->fail('Expected claim conflict.');
    }
    catch (ClaimConflictException) {
    }
  }

  /**
   * Activities for a ticket, optionally restricted by kind, oldest first.
   *
   * @return list<\Drupal\Core\Entity\EntityInterface>
   *   Loaded activity entities.
   */
  private function loadActivities(int $ticket_id, ?string $kind = NULL): array {
    $query = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket_id)
      ->sort('id');
    if ($kind !== NULL) {
      $query->condition('kind', $kind);
    }
    $ids = $query->execute();
    return array_values($this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->loadMultiple($ids));
  }

}
