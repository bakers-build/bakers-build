<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Claim\TicketClaimedEvent;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
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
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketClaimServiceTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
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
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
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
    // `administer bakers` lets the owner work in any project
    // (BbConductorOwnerAccess); ConductorOwnerAccessTest covers the rule.
    user_role_grant_permissions($role_id, ['register bakers conductor', 'claim bakers tickets', 'administer bakers']);
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
    array $states = ['plan', 'working'],
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
   * Creates and saves a BbTicket in its claimable entry state ('plan').
   *
   * The ticket is advanced to the 'plan' work state, so it is immediately
   * claimable without an explicit activation.
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
        'workflow' => 'bb_work',
        'title' => $identifier,
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    // The bb_work workflow enters 'qualification' first (BB-196);
    // advance to 'plan', the claimable work state the default conductor
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
  public function testClaimCreatesRunAndLease(): void {
    $owner = $this->createConductorUser('claim-owner');
    $this->container->get('current_user')->setAccount($owner);
    $conductor = $this->createConductor($owner, 'node-c');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-C2'), $conductor);

    $run = $this->claim()->claim($ticket, $conductor, 600);
    $this->assertSame('claimed', $run->getRunState());
    $this->assertSame('plan', $run->get('state_at_start')->value);
    $this->assertGreaterThan(
      $this->container->get('datetime.time')->getRequestTime(),
      $run->getClaimExpiresAt(),
    );
  }

  /**
   * Verifies that a second claim on an already-claimed ticket fails.
   *
   * Expects a ClaimConflictException to be thrown.
   */
  public function testSecondClaimConflicts(): void {
    $owner = $this->createConductorUser('conflict-owner');
    $conductor_a = $this->createConductor($owner, 'node-d');
    $conductor_b = $this->createConductor($owner, 'node-e');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-C3'), $conductor_a);

    $this->claim()->claim($ticket, $conductor_a, 600);
    $this->expectClaimConflict(fn () => $this->claim()->claim($ticket, $conductor_b, 600));
  }

  /**
   * Verifies that claiming a non-claimable or blocked ticket throws a conflict.
   *
   * Tickets in a terminal (non-claimable) state and tickets with open blockers
   * must raise ClaimConflictException.
   */
  public function testClaimRejectsBlockedAndInactiveTickets(): void {
    $owner = $this->createConductorUser('guard-owner');
    $conductor = $this->createConductor($owner, 'node-f');

    // A cancelled ticket is in a non-claimable terminal state.
    $cancelled = $this->assignToConductor($this->createActiveTicket('GL-C4'), $conductor);
    $cancelled->getState()->applyTransitionById('cancel');
    $cancelled->save();
    $this->expectClaimConflict(fn () => $this->claim()->claim($cancelled, $conductor, 600));

    $blocker = $this->createActiveTicket('GL-C5');
    $blocked = $this->assignToConductor(
      $this->createActiveTicket('GL-C6', ['blocked_by' => [$blocker->id()]]),
      $conductor,
    );
    $this->expectClaimConflict(fn () => $this->claim()->claim($blocked, $conductor, 600));
  }

  /**
   * Verifies that a conductor cannot claim states it is not registered for.
   */
  public function testClaimRejectsUnregisteredState(): void {
    $owner = $this->createConductorUser('state-owner');
    $right_states = $this->createConductor($owner, 'node-i', ['plan']);
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-C8'), $right_states);

    $wrong_states = $this->createConductor($owner, 'node-h', ['working', 'review']);
    $this->expectClaimConflict(fn () => $this->claim()->claim($ticket, $wrong_states, 600));

    $this->assertSame('claimed', $this->claim()->claim($ticket, $right_states, 600)->getRunState());
  }

  /**
   * A conductor with an EMPTY state list claims every claimable state.
   *
   * An empty `states` list means the conductor serves all claimable states in
   * its project (BB-207) — no per-conductor allow-list narrows it. The same
   * conductor claims tickets in `plan`, `working` and `review`. A non-empty
   * list still restricts (see testClaimRejectsUnregisteredState).
   */
  public function testEmptyStatesClaimsAllClaimableStates(): void {
    $owner = $this->createConductorUser('empty-states-owner');
    $conductor = $this->createConductor($owner, 'node-empty', []);

    $plan = $this->assignToConductor($this->createActiveTicket('GL-ES1'), $conductor);

    $working = $this->assignToConductor($this->createActiveTicket('GL-ES2'), $conductor);
    $working->getState()->applyTransitionById('to_working');
    $working->save();

    $review = $this->assignToConductor($this->createActiveTicket('GL-ES3'), $conductor);
    $review->getState()->applyTransitionById('to_working');
    $review->getState()->applyTransitionById('to_review');
    $review->save();

    $this->assertSame('plan', $plan->get('state')->value);
    $this->assertSame('working', $working->get('state')->value);
    $this->assertSame('review', $review->get('state')->value);

    $this->assertSame('plan', $this->claim()->claim($plan, $conductor, 600)->get('state_at_start')->value);
    $this->assertSame('working', $this->claim()->claim($working, $conductor, 600)->get('state_at_start')->value);
    $this->assertSame('review', $this->claim()->claim($review, $conductor, 600)->get('state_at_start')->value);
  }

  /**
   * ClaimNext() with an empty state list applies no state filter.
   *
   * The candidate query drops its `state IN (...)` clause when the conductor
   * carries no state list, so a ticket in any claimable state (here `review`,
   * outside the legacy default set) is surfaced (BB-207).
   */
  public function testClaimNextWithEmptyStatesIgnoresState(): void {
    $owner = $this->createConductorUser('empty-next-owner');
    $conductor = $this->createConductor($owner, 'node-empty-next', []);
    $review = $this->assignToConductor($this->createActiveTicket('GL-ESN'), $conductor);
    $review->getState()->applyTransitionById('to_working');
    $review->getState()->applyTransitionById('to_review');
    $review->save();

    $run = $this->claim()->claimNext($conductor, 600);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $this->assertSame((int) $review->id(), $run->getTicketId());
    $this->assertSame('review', $run->get('state_at_start')->value);
  }

  /**
   * Verifies that ticket and conductor must belong to the same project.
   *
   * A conductor from another project and a ticket without any project must
   * both be rejected.
   */
  public function testClaimRejectsProjectMismatch(): void {
    $owner = $this->createConductorUser('project-owner');
    $other_project = $this->createProject('other-project');
    $foreign = $this->createConductor($owner, 'node-j', ['plan', 'working'], $other_project);

    // Assign to owner so the assignee check passes; project mismatch blocks.
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-P1'), $foreign);
    $this->expectClaimConflict(fn () => $this->claim()->claim($ticket, $foreign, 600));
    // Project-less tickets are no longer expressible: project_id is required
    // for multi-workspace tenancy (BB-321 workspace-anchor contract).
  }

  /**
   * Verifies that a ticket assigned to no conductor cannot be claimed.
   */
  public function testTicketWithoutConductorIsNotClaimable(): void {
    $owner = $this->createConductorUser('unassigned-owner');
    $conductor = $this->createConductor($owner, 'node-unassigned');
    // Classified ticket without conductor_id must be rejected.
    $ticket = $this->createActiveTicket('GL-UA1');
    $this->expectException(ClaimConflictException::class);
    $this->claim()->claim($ticket, $conductor, 300);
  }

  /**
   * Verifies that a ticket assigned to the claiming conductor is claimable.
   */
  public function testTicketAssignedToConductorIsClaimable(): void {
    $owner = $this->createConductorUser('assigned-owner');
    $conductor = $this->createConductor($owner, 'node-assigned');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-UA2'), $conductor);
    $run = $this->claim()->claim($ticket, $conductor, 300);
    $this->assertSame('claimed', $run->getRunState());
  }

  /**
   * Verifies that a ticket assigned to another conductor cannot be claimed.
   */
  public function testTicketAssignedToOtherConductorIsNotClaimable(): void {
    $owner = $this->createConductorUser('other-owner');
    $conductor = $this->createConductor($owner, 'node-other');
    $other_conductor = $this->createConductor($owner, 'node-other-2');
    // Assigned to a different conductor — the claiming conductor is rejected.
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-UA3'), $other_conductor);
    $this->expectException(ClaimConflictException::class);
    $this->claim()->claim($ticket, $conductor, 300);
  }

  /**
   * Verifies that the user assignee alone never makes a ticket claimable.
   *
   * A ticket assigned to a human user but to no conductor must not be claimed —
   * user assignment is decoupled from run start.
   */
  public function testUserAssignmentAloneDoesNotMakeClaimable(): void {
    $owner = $this->createConductorUser('user-only-owner');
    $conductor = $this->createConductor($owner, 'node-user-only');
    $human = $this->createUser('human-assignee');
    // Only a user assignee, no conductor_id — must be rejected.
    $ticket = $this->createActiveTicket('GL-USER-ONLY', ['assignee_user_id' => $human->id()]);
    $this->expectException(ClaimConflictException::class);
    $this->claim()->claim($ticket, $conductor, 300);
  }

  /**
   * A LIVE-lease active run for the current state still blocks reclaim.
   *
   * A same-state active run whose lease is in the future is a genuine
   * concurrent claim and raises ClaimConflictException. (An EXPIRED-lease run,
   * by contrast, is a zombie and is expired out of the way — BB-63; covered
   * by testExpiredLeaseActiveRunDoesNotBlockReclaim.)
   */
  public function testLiveLeaseActiveRunBlocksReclaim(): void {
    $owner = $this->createConductorUser('expire-owner');
    $conductor = $this->createConductor($owner, 'node-g');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-C7'), $conductor);

    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'state_at_start' => 'plan',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();

    $this->expectException(ClaimConflictException::class);
    $this->claim()->claim($ticket, $conductor, 300);
  }

  /**
   * A RUNNING same-state run blocks reclaim even with a lapsed lease.
   *
   * A running run is genuinely live regardless of its lease (no renewal path),
   * so it always conflicts — only a claimed-but-never-started run is reaped.
   */
  public function testExpiredLeaseRunningRunStillBlocksReclaim(): void {
    $owner = $this->createConductorUser('running-owner');
    $conductor = $this->createConductor($owner, 'node-running');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-RUN'), $conductor);

    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'state_at_start' => 'plan',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() - 3600,
    ])->save();

    $this->expectException(ClaimConflictException::class);
    $this->claim()->claim($ticket, $conductor, 300);
  }

  /**
   * An EXPIRED-lease same-state run is a zombie and does NOT block reclaim.
   *
   * The lease-expiry fix (BB-63): a claimed-but-never-started (or dead) run
   * whose claim_expires_at has lapsed must not permanently block its ticket.
   * It is terminalised to `expired` and the claim succeeds.
   */
  public function testExpiredLeaseActiveRunDoesNotBlockReclaim(): void {
    $owner = $this->createConductorUser('expired-zombie-owner');
    $conductor = $this->createConductor($owner, 'node-zombie');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-ZMB'), $conductor);

    $zombie = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'claimed',
      'state_at_start' => 'plan',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() - 3600,
    ]);
    $zombie->save();

    $run = $this->claim()->claim($ticket, $conductor, 300);

    $this->assertSame('claimed', $run->getRunState());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$zombie->id()]);
    $reaped = $storage->load($zombie->id());
    $this->assertInstanceOf(BbRunInterface::class, $reaped);
    $this->assertSame('expired', $reaped->getRunState());
  }

  /**
   * Verifies a completed run does NOT block a new claim for the same state.
   *
   * Terminal runs (state=done) never block re-entry. State re-entry is allowed
   * so that an agent can retry or continue after completing a previous run.
   */
  public function testTerminalRunForCurrentStateDoesNotBlockReclaim(): void {
    $owner = $this->createConductorUser('terminal-owner');
    $conductor = $this->createConductor($owner, 'node-terminal');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-TERM'), $conductor);

    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'done',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
      'state_at_start' => 'plan',
    ])->save();

    $run = $this->claim()->claim($ticket, $conductor, 600);
    $this->assertSame('claimed', $run->getRunState());
  }

  /**
   * Verifies a completed old-state run does not block a later ticket state.
   */
  public function testTerminalRunForPreviousStateDoesNotBlockNextState(): void {
    $owner = $this->createConductorUser('terminal-next-owner');
    $conductor = $this->createConductor($owner, 'node-terminal-next', ['plan', 'working']);
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-TERM-NEXT'), $conductor);

    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'done',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
      'state_at_start' => 'plan',
    ])->save();

    $ticket->getState()->applyTransitionById('to_working');
    $ticket->save();

    $run = $this->claim()->claim($ticket, $conductor, 600);
    $this->assertSame('claimed', $run->getRunState());
  }

  /**
   * Verifies claimNext() picks tickets in ascending priority order.
   *
   * Lower priority value means higher priority; already-claimed tickets are
   * skipped.
   */
  public function testClaimNextPicksByPrioritySorting(): void {
    $owner = $this->createConductorUser('next-owner');
    $conductor = $this->createConductor($owner, 'node-n');

    $low = $this->assignToConductor($this->createActiveTicket('GL-N1', ['priority' => 5]), $conductor);
    $high = $this->assignToConductor($this->createActiveTicket('GL-N2', ['priority' => 1]), $conductor);
    $none = $this->assignToConductor($this->createActiveTicket('GL-N3'), $conductor);

    $this->assertSame((int) $high->id(), $this->claim()->claimNext($conductor, 600)->getTicketId());
    $this->assertSame((int) $low->id(), $this->claim()->claimNext($conductor, 600)->getTicketId());
    $this->assertSame((int) $none->id(), $this->claim()->claimNext($conductor, 600)->getTicketId());
  }

  /**
   * Verifies claimNext() skips ineligible tickets and claims the first match.
   *
   * A higher-priority ticket assigned to a different conductor must be skipped;
   * the conductor claims only the ticket assigned to itself.
   */
  public function testClaimNextSkipsIneligibleCandidates(): void {
    $owner = $this->createConductorUser('skip-owner');
    $conductor = $this->createConductor($owner, 'node-o');
    $other_conductor = $this->createConductor($owner, 'node-o-2');

    // Higher priority but assigned to a different conductor — must be skipped.
    $this->assignToConductor(
      $this->createActiveTicket('GL-N4', ['priority' => 1]),
      $other_conductor,
    );
    $good = $this->assignToConductor($this->createActiveTicket('GL-N6', ['priority' => 3]), $conductor);

    $run = $this->claim()->claimNext($conductor, 600);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $this->assertSame((int) $good->id(), $run->getTicketId());
  }

  /**
   * Verifies claimNext() never lets closed tickets crowd out the candidate.
   *
   * A conductor accumulates far more than CANDIDATE_LIMIT closed tickets over
   * its lifetime (every finished ticket stays assigned to it). The candidate
   * query is bounded to CANDIDATE_LIMIT rows, so without excluding closed
   * tickets a backlog of them fills the whole window and the one open,
   * claimable ticket — created last, so ordered outside a naive window — is
   * never fetched, making claimNext() return NULL forever. Closed tickets must
   * be filtered at the query level so the open ticket is always claimable.
   */
  public function testClaimNextSkipsClosedTicketsBeyondCandidateWindow(): void {
    $owner = $this->createConductorUser('closed-window-owner');
    $conductor = $this->createConductor($owner, 'node-closed-window');

    // Fill more than the candidate window with closed tickets in an otherwise
    // claimable state, all assigned to this conductor.
    for ($i = 0; $i < 51; $i++) {
      $closed = $this->assignToConductor($this->createActiveTicket("GL-CW-$i"), $conductor);
      $closed->set('closed', TRUE)->save();
    }

    // One open, claimable ticket, created last (highest id).
    $open = $this->assignToConductor($this->createActiveTicket('GL-CW-OPEN'), $conductor);

    $run = $this->claim()->claimNext($conductor, 600);
    $this->assertInstanceOf(
      BbRunInterface::class,
      $run,
      'claimNext() must claim the open ticket despite a full window of closed tickets.',
    );
    $this->assertSame((int) $open->id(), $run->getTicketId());
  }

  /**
   * Verifies claimNext() skips a conductor-less ticket, claims once assigned.
   *
   * The ticket is state-eligible (plan, handled by the conductor) and
   * project-eligible (same project). The ONLY reason claimNext() returns NULL
   * is the missing conductor assignment. After assignment to the conductor, a
   * second claimNext() call must return a run — proving conductor assignment is
   * the deciding factor.
   */
  public function testClaimNextSkipsUnassignedEligibleTicket(): void {
    $owner = $this->createConductorUser('unassigned-next-owner');
    $conductor = $this->createConductor($owner, 'node-unassigned-next');

    // Right project, right state, but assigned to no conductor.
    $ticket = $this->createActiveTicket('GL-UA-NEXT');

    // Phase 1: no conductor — the conductor gate filters the only candidate.
    $this->assertNull($this->claim()->claimNext($conductor, 600));

    // Phase 2: assign to this conductor — it must now be claimable.
    $this->assignToConductor($ticket, $conductor)->save();
    $run = $this->claim()->claimNext($conductor, 600);
    // @phpstan-ignore method.impossibleType
    $this->assertNotNull($run);
    $this->assertSame((int) $ticket->id(), $run->getTicketId());
  }

  /**
   * Verifies claimNext() only sees tickets of the conductor's project.
   */
  public function testClaimNextScopedToProject(): void {
    $owner = $this->createConductorUser('scope-owner');
    $other_project = $this->createProject('scope-other');
    $conductor = $this->createConductor($owner, 'node-r', ['plan', 'working'], $other_project);

    $this->createActiveTicket('GL-S1');

    $this->assertNull($this->claim()->claimNext($conductor, 600));
  }

  /**
   * Verifies claimNext() returns NULL when no eligible ticket exists.
   */
  public function testClaimNextReturnsNullWhenNothingEligible(): void {
    $owner = $this->createConductorUser('empty-owner');
    $conductor = $this->createConductor($owner, 'node-q');
    // The only ticket is in a terminal (non-claimable) state, so claimNext()
    // must find nothing eligible.
    $ticket = $this->createActiveTicket('GL-N7');
    $ticket->getState()->applyTransitionById('cancel');
    $ticket->save();

    $this->assertNull($this->claim()->claimNext($conductor, 600));
  }

  /**
   * Verifies a running state blocks reclaim when state_at_start matches.
   *
   * An active run in 'running' state whose state_at_start equals the current
   * ticket state is a genuine concurrent claim and must raise a conflict.
   */
  public function testRunningStateBlocksReclaim(): void {
    $owner = $this->createConductorUser('wfi-lease-owner');
    $conductor = $this->createConductor($owner, 'node-wfi3');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-WFI3'), $conductor);

    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'state_at_start' => 'plan',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 3600,
    ])->save();

    $this->expectClaimConflict(fn () => $this->claim()->claim($ticket, $conductor, 600));
  }

  /**
   * A claim announces itself once, with its ticket, run and conductor.
   */
  public function testClaimDispatchesTicketClaimedEvent(): void {
    $owner = $this->createConductorUser('event-owner');
    $conductor = $this->createConductor($owner, 'node-event');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-EVENT'), $conductor);
    $events = [];
    $this->container->get('event_dispatcher')->addListener(TicketClaimedEvent::NAME, static function (TicketClaimedEvent $event) use (&$events): void {
      $events[] = $event;
    });

    $run = $this->claim()->claim($ticket, $conductor, 300);

    $this->assertCount(1, $events);
    $this->assertSame((string) $ticket->id(), (string) $events[0]->ticket->id());
    $this->assertSame((string) $run->id(), (string) $events[0]->run->id());
    $this->assertSame((string) $conductor->id(), (string) $events[0]->conductor->id());
  }

  /**
   * A subscriber failing on the claim event rolls the claim back.
   */
  public function testFailingClaimSubscriberRollsBackClaim(): void {
    $owner = $this->createConductorUser('failing-subscriber-owner');
    $conductor = $this->createConductor($owner, 'node-failing-subscriber');
    $ticket = $this->assignToConductor($this->createActiveTicket('GL-FAIL-SUB'), $conductor);
    $this->container->get('event_dispatcher')->addListener(TicketClaimedEvent::NAME, static function (): void {
      throw new \RuntimeException('subscriber failed');
    });

    $this->expectClaimConflict(fn () => $this->claim()->claim($ticket, $conductor, 300));
    $this->container->get('entity_type.manager')->getStorage('bb_run')->resetCache();
    $runs = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadByProperties([
      'ticket_id' => $ticket->id(),
    ]);
    $this->assertCount(0, $runs);
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

}
