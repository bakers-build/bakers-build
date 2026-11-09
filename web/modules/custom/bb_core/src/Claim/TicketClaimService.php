<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\bb_core\Conductor\ConductorOwnerAccess;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;

/**
 * Atomic distributed ticket claim with full server-side eligibility recheck.
 *
 * Eligibility model: a conductor registers per project, optionally narrowing
 * to a list of workflow states it handles. A ticket is claimable when its
 * project matches the conductor, the state is marked `claimable` in the
 * workflow, the ticket is assigned to that conductor, it is not frozen, no
 * blockers are open, and no active run exists. An empty state list means the
 * conductor serves every claimable state in its project.
 *
 * Conductor assignment: a classified ticket MUST be assigned to a conductor
 * (`conductor_id`), and that conductor must be the one claiming. The user
 * assignee (`assignee_user_id`) is human ownership only and does not affect
 * claiming. Unclassified tickets (no workflow) are exempt — any conductor for
 * the project may claim them for qualification.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class TicketClaimService {

  private const ACTIVE_RUN_STATES = ['claimed', 'running'];
  private const CANDIDATE_LIMIT = 50;
  public const DEFAULT_LEASE_SECONDS = 300;
  public const MAX_LEASE_SECONDS = 3600;

  /**
   * Constructs a TicketClaimService.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   The time service used to set and evaluate lease timestamps.
   * @param \Drupal\Core\Lock\LockBackendInterface $lock
   *   The distributed lock backend used to serialise concurrent claim attempts.
   * @param \Drupal\Core\Database\Connection $database
   *   The database connection used to wrap claim logic in a transaction.
   * @param \Drupal\bb_core\Claim\FailedRunCircuitBreaker $circuitBreaker
   *   The failed-run re-claim circuit breaker.
   * @param \Symfony\Contracts\EventDispatcher\EventDispatcherInterface $dispatcher
   *   Announces a successful claim inside this transaction.
   * @param \Drupal\bb_core\Conductor\ConductorOwnerAccess $ownerAccess
   *   Whether the conductor's owner may work in the ticket's project.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly LockBackendInterface $lock,
    private readonly Connection $database,
    private readonly FailedRunCircuitBreaker $circuitBreaker,
    private readonly EventDispatcherInterface $dispatcher,
    private readonly ConductorOwnerAccess $ownerAccess,
  ) {
  }

  /**
   * Atomically claims a ticket for the given conductor and returns the new run.
   *
   * Acquires a distributed lock, reloads and re-validates the ticket inside a
   * database transaction, creates a BbRun entity with state "claimed", and
   * performs a final consistency check before committing.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to claim.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the claim.
   * @param int $lease_seconds
   *   Requested lease duration in seconds; clamped to MAX_LEASE_SECONDS.
   *
   * @return \Drupal\bb_core\Entity\BbRunInterface
   *   The newly created and saved run entity.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the ticket cannot be claimed (concurrent claim, eligibility
   *   check failure, or a state change detected during the transaction).
   */
  public function claim(BbTicketInterface $ticket, BbConductorInterface $conductor, ?int $lease_seconds = NULL): BbRunInterface {
    $lease_seconds = max(1, min($lease_seconds ?? self::DEFAULT_LEASE_SECONDS, self::MAX_LEASE_SECONDS));
    $lock_name = 'bb_claim:' . $ticket->id();
    if (!$this->lock->acquire($lock_name, 10.0)) {
      throw new ClaimConflictException('claim_conflict: ticket is being claimed concurrently.');
    }

    $transaction = $this->database->startTransaction();
    try {
      $ticket_storage = $this->entityTypeManager->getStorage('bb_ticket');
      $select = $this->database->select('bb_ticket', 't');
      $select->fields('t', ['state']);
      $select->condition('id', (string) $ticket->id());
      $select->forUpdate();
      $select->execute()->fetchField();
      $ticket_storage->resetCache([$ticket->id()]);
      $fresh = $ticket_storage->load($ticket->id());
      if (!$fresh instanceof BbTicketInterface) {
        throw new ClaimConflictException('claim_conflict: ticket vanished.');
      }

      $checked_state = (string) $fresh->get('state')->value;
      $this->assertEligible($fresh, $conductor);
      $machine_lock = $this->assertMachineCapacity($conductor);

      $now = $this->time->getRequestTime();
      $run = $this->entityTypeManager->getStorage('bb_run')->create([
        'ticket_id' => $fresh->id(),
        'conductor_id' => $conductor->id(),
        // Written explicitly from the conductor rather than defaulted from the
        // acting account: a run's visibility must not depend on who happened to
        // hold the session when it was claimed.
        'owner_user_id' => $conductor->get('owner_user_id')->target_id,
        'state' => 'claimed',
        'claim_expires_at' => $now + $lease_seconds,
        'state_at_start' => $checked_state,
        'started_at' => $now,
      ]);
      $run->save();
      assert($run instanceof BbRunInterface);

      $ticket_storage->resetCache([$fresh->id()]);
      $recheck = $ticket_storage->load($fresh->id());
      if (!$recheck instanceof BbTicketInterface
        || (string) $recheck->get('state')->value !== $checked_state
        || $recheck->hasOpenBlockers()
        || $recheck->isFrozen()) {
        throw new ClaimConflictException('claim_conflict: ticket changed during claim.');
      }

      $this->dispatcher->dispatch(new TicketClaimedEvent($fresh, $run, $conductor), TicketClaimedEvent::NAME);
      $transaction->commitOrRelease();
      return $run;
    }
    catch (\Throwable $e) {
      $transaction->rollBack();
      throw $e instanceof ClaimConflictException
        ? $e
        : new ClaimConflictException('claim_conflict: ' . $e->getMessage(), 0, $e);
    }
    finally {
      if (isset($machine_lock)) {
        $this->lock->release($machine_lock);
      }
      $this->lock->release($lock_name);
    }
  }

  /**
   * Claims the best matching ticket for the conductor, or NULL when none found.
   *
   * Queries up to CANDIDATE_LIMIT tickets in the conductor's project that are
   * assigned to it (or that are unclassified — no workflow yet), sorts them by
   * priority then creation time, and attempts to claim each one in order,
   * skipping candidates that race away. A configured state list narrows the
   * candidates to those states; an empty list applies no state filter — the
   * conductor serves every claimable state in its project.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the next assignment.
   * @param int $lease_seconds
   *   Requested lease duration in seconds; clamped to MAX_LEASE_SECONDS.
   *
   * @return \Drupal\bb_core\Entity\BbRunInterface|null
   *   The newly created run entity, or NULL when nothing was claimed.
   */
  public function claimNext(BbConductorInterface $conductor, ?int $lease_seconds = NULL): ?BbRunInterface {
    return $this->claimNextResult($conductor, $lease_seconds)->run;
  }

  /**
   * Claims the next ticket and preserves any machine-capacity refusal.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the next assignment.
   * @param int|null $lease_seconds
   *   Requested lease duration in seconds.
   *
   * @return \Drupal\bb_core\Claim\ClaimNextResult
   *   A run, an observed capacity refusal, or an empty result.
   */
  public function claimNextResult(BbConductorInterface $conductor, ?int $lease_seconds = NULL): ClaimNextResult {
    if (!(bool) $conductor->get('active')->value) {
      return new ClaimNextResult();
    }
    $states = $conductor->getStates();
    $project_id = $conductor->get('project_id')->target_id;
    if (!is_numeric($project_id) || !$this->ownerAccess->ownerHasAccess($conductor, (int) $project_id)) {
      return new ClaimNextResult();
    }

    // Reap this conductor's claimed-but-never-started zombies up front: any of
    // its runs still `claimed` past their lease is expired here, so it stops
    // counting toward capacity (activeRunCount counts only [claimed,running])
    // and its ticket becomes claimable again — including as a candidate in this
    // very call. No cron: a claimed run carries no work (no transcript), so
    // there is nothing to preserve; the next claim mints a fresh run.
    $this->expireStaleClaims($conductor);

    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('project_id', (int) $project_id)
      // Closed tickets are finished and never claimable, but they stay assigned
      // to their conductor forever. Without this filter a lifetime backlog of
      // closed tickets fills the bounded candidate window and starves the open,
      // claimable tickets that were created later (higher id) — claimNext()
      // would then return NULL despite eligible work. Excluding them at the
      // query level keeps the window populated by live candidates only. Runs
      // that still need worktree cleanup use their own done-and-not-cleaned
      // query, so this does not affect finalisation.
      ->condition('closed', 0)
      // Frozen tickets stay assigned but are held out of the dispatch loop
      // until an operator clears the flag. Filter at query level so a backlog
      // of frozen rows cannot fill the bounded candidate window.
      ->condition('frozen', 0)
      // Most-recently-changed first: deterministic ordering that keeps the
      // freshly-active claimable tickets inside the bounded window even if the
      // live (non-closed) set ever exceeds CANDIDATE_LIMIT.
      ->sort('changed', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, self::CANDIDATE_LIMIT);
    // Include classified tickets assigned to this conductor, plus unclassified
    // tickets (no workflow) that any conductor may qualify. A configured state
    // list narrows the classified candidates to those states; an empty list
    // applies no state filter — the conductor serves every claimable state in
    // its project.
    $classified = $query->andConditionGroup()
      ->condition('conductor_id', $conductor->id());
    if ($states !== []) {
      $classified->condition('state', $states, 'IN');
    }
    $orEligible = $query->orConditionGroup()
      ->condition($classified)
      ->notExists('workflow');
    $ids = $query->condition($orEligible)->execute();
    if ($ids === []) {
      return new ClaimNextResult();
    }

    $candidates = array_values(array_filter(
      $storage->loadMultiple($ids),
      static fn ($ticket): bool => $ticket instanceof BbTicketInterface,
    ));
    usort($candidates, self::compareCandidates(...));

    $withheld = NULL;
    foreach ($candidates as $candidate) {
      try {
        return new ClaimNextResult(run: $this->claim($candidate, $conductor, $lease_seconds));
      }
      catch (MachineCapacityException $e) {
        // Keep trying: another candidate may retire its previous-state run.
        $withheld = $e;
      }
      catch (ClaimConflictException) {
        // Candidate raced away or failed a per-conductor dimension.
      }
    }
    return new ClaimNextResult(capacity: $withheld);
  }

  /**
   * Compares two candidate tickets: priority asc (null last), created, id.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $a
   *   First candidate.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $b
   *   Second candidate.
   *
   * @return int
   *   Standard comparator result.
   */
  private static function compareCandidates(BbTicketInterface $a, BbTicketInterface $b): int {
    $pa = $a->getPriority();
    $pb = $b->getPriority();
    if ($pa !== $pb) {
      if ($pa === NULL) {
        return 1;
      }
      if ($pb === NULL) {
        return -1;
      }
      return $pa <=> $pb;
    }
    $created = $a->getCreatedTime() <=> $b->getCreatedTime();
    return $created !== 0 ? $created : strcmp($a->getIdentifier(), $b->getIdentifier());
  }

  /**
   * Throws ClaimConflictException when the conductor is ineligible for ticket.
   *
   * Check order: claimable state (+ optional per-conductor state list), project
   * match, conductor assignment, owner access, open blockers, then
   * retire-or-conflict on active runs.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The freshly reloaded ticket to validate.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the claim.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when any eligibility dimension is not satisfied.
   */
  private function assertEligible(BbTicketInterface $ticket, BbConductorInterface $conductor): void {
    ConductorActiveGuard::assertActive($conductor);
    $this->assertNotFrozen($ticket);
    $this->assertClaimableState($ticket, $conductor);
    $this->assertProjectMatch($ticket, $conductor);
    $this->assertConductorAssignment($ticket, $conductor);
    if (!$this->ownerAccess->ownerHasAccess($conductor, (int) $ticket->get('project_id')->target_id)) {
      throw new ClaimConflictException('claim_conflict: conductor owner has no access to the project.');
    }
    if ($ticket->hasOpenBlockers()) {
      throw new ClaimConflictException('claim_conflict: ticket has open blockers.');
    }
    $this->circuitBreaker->assertClaimable($ticket);
    $this->retireSupersededRuns($ticket);
  }

  /**
   * Refuses a ticket an operator has held out of the dispatch loop.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the ticket's frozen flag is set.
   */
  private function assertNotFrozen(BbTicketInterface $ticket): void {
    if ($ticket->isFrozen()) {
      throw new ClaimConflictException('claim_conflict: ticket is frozen.');
    }
  }

  /**
   * Enforces the shared host budget as a hard ceiling at the claim seam.
   *
   * The machine's own `max_parallel` bounds the number of live runs
   * (`[claimed, running]`) carried by conductors linked to it — counted from
   * `bb_run` rows, not the heartbeat-lagged `reported_load` telemetry, so a
   * crashed conductor's abandoned claims free capacity again as they expire.
   * A machine-scoped lock is held across the count-and-mint so two
   * concurrent claims on the same machine cannot both pass the count. A
   * conductor with no linked machine is
   * unbounded, matching today's behaviour.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the claim.
   *
   * @return string|null
   *   The acquired machine lock name, to be released by the caller once the
   *   run is minted, or NULL when the conductor carries no machine link.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the machine is already at its budget.
   */
  private function assertMachineCapacity(BbConductorInterface $conductor): ?string {
    $machine = $conductor->getMachine();
    if ($machine === NULL) {
      return NULL;
    }
    $lock_name = 'bb_machine:' . $machine->id();
    if (!$this->lock->acquire($lock_name, 10.0)) {
      throw new ClaimConflictException('claim_conflict: machine is being claimed concurrently.');
    }
    $live = $this->countLiveRunsOnMachine((int) $machine->id());
    if ($live >= $machine->getMaxParallel()) {
      $this->lock->release($lock_name);
      throw new MachineCapacityException($live, $machine->getMaxParallel());
    }
    return $lock_name;
  }

  /**
   * Counts live runs ([claimed, running]) of conductors linked to a machine.
   *
   * A `claimed` run whose lease has already lapsed is excluded: it is a
   * claimed-but-never-started zombie of the same shape `expireStaleClaims()`
   * reaps for its own conductor, and here it may belong to a DIFFERENT,
   * crashed conductor on the same machine — nothing on this machine's other
   * conductors ever calls that reap for it. Counting it as live would let one
   * abandoned claim occupy a budget slot forever. A `running` run is always
   * live — there is no lease-renewal path, so its lease says nothing about
   * liveness.
   *
   * @param int $machine_id
   *   The bb_machine entity id.
   *
   * @return int
   *   The number of live runs currently carried by the machine.
   */
  private function countLiveRunsOnMachine(int $machine_id): int {
    $conductor_storage = $this->entityTypeManager->getStorage('bb_conductor');
    $conductor_ids = $conductor_storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('machine', $machine_id)
      ->execute();
    if ($conductor_ids === []) {
      return 0;
    }
    $now = $this->time->getRequestTime();
    $query = $this->entityTypeManager->getStorage('bb_run')->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id', $conductor_ids, 'IN');
    $live = $query->orConditionGroup()
      ->condition('state', 'running')
      ->condition($query->andConditionGroup()
        ->condition('state', 'claimed')
        ->condition($query->orConditionGroup()
          ->condition('claim_expires_at', 0)
          ->condition('claim_expires_at', $now, '>=')));
    return (int) $query->condition($live)->count()->execute();
  }

  /**
   * Enforces the single-active-run invariant when claiming.
   *
   * A same-state active run is a genuine concurrent claim and conflicts; the
   * stale (different-state) runs are closed via closeRunsForState().
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when an active run for the current state already exists.
   */
  private function retireSupersededRuns(BbTicketInterface $ticket): void {
    $state = (string) $ticket->get('state')->value;
    $now = $this->time->getRequestTime();
    $storage = $this->entityTypeManager->getStorage('bb_run');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('state', self::ACTIVE_RUN_STATES, 'IN')
      ->execute();
    foreach ($storage->loadMultiple($ids) as $run) {
      if (!$run instanceof BbRunInterface
        || (string) $run->get('state_at_start')->value !== $state) {
        continue;
      }
      // A same-state `claimed` run whose lease has lapsed is a claimed-but-
      // never-started zombie: expire it out of the way (same reaping as
      // expireStaleClaims, applied to a direct claim of a specific ticket) so
      // the ticket re-claims instead of conflicting. `claim_expires_at > 0`
      // guards a never-leased run, treated as a genuine live claim. A `running`
      // run is genuinely live regardless of its lease (no renewal path) and
      // always conflicts.
      $expires = $run->getClaimExpiresAt();
      if ($run->getRunState() === 'claimed'
        && $expires !== NULL && $expires > 0 && $expires < $now) {
        $run->setRunState('expired')->save();
        continue;
      }
      throw new ClaimConflictException('claim_conflict: an active run exists for this state.');
    }
    $this->closeRunsForState($ticket);
  }

  /**
   * Expires this conductor's claimed-but-never-started runs past their lease.
   *
   * A run created `claimed` whose agent never started (never → `running`) lets
   * its `claim_expires_at` lapse. Nothing else enforces the lease, so such a
   * run would sit `claimed` forever: counting toward the conductor's capacity
   * (`activeRunCount` counts `[claimed,running]`) and blocking its ticket via
   * the single-active-run gate. Flipping it to the terminal `expired` state
   * frees both. Only `claimed` runs are touched — a `running` run is genuinely
   * live; with no lease-renewal path its lease says nothing about liveness.
   * `claim_expires_at > 0` skips runs that never had a lease set.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor whose stale claims to reap.
   *
   * @return int
   *   The number of runs terminalised to `expired`.
   */
  public function expireStaleClaims(BbConductorInterface $conductor): int {
    $now = $this->time->getRequestTime();
    $storage = $this->entityTypeManager->getStorage('bb_run');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id', $conductor->id())
      ->condition('state', 'claimed')
      ->condition('claim_expires_at', 0, '>')
      ->condition('claim_expires_at', $now, '<')
      ->execute();
    $count = 0;
    foreach ($storage->loadMultiple($ids) as $run) {
      if (!$run instanceof BbRunInterface) {
        continue;
      }
      // Re-check under the freshly loaded entity: this method holds no lock, so
      // an agent may have transitioned the run `claimed` -> `running` between
      // the query and this load (lease expiry no longer gates `start`). A bare
      // ->save() bypasses the state_machine transition guard, so without this
      // re-check we would clobber a genuinely live `running` run to `expired` —
      // exactly the invariant this fix promises never to break. Mirrors the
      // same guard in retireSupersededRuns().
      if ($run->getRunState() !== 'claimed') {
        continue;
      }
      $run->setRunState('expired')->save();
      $count++;
    }
    return $count;
  }

  /**
   * Closes active runs whose start-state no longer matches the ticket state.
   *
   * Fires on claim (via retireSupersededRuns) and on every ticket transition
   * (TicketTransitionSubscriber): the run that executed the PREVIOUS state has
   * finished and is set to `done`. The run's `log` is left
   * untouched — the conductor finalisation tick writes the real transcript
   * once the run is done; there is no "superseded by claim" placeholder.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket whose current state is the new state.
   *
   * @return list<int>
   *   The ids of the runs retired.
   */
  public function closeRunsForState(BbTicketInterface $ticket): array {
    $state = (string) $ticket->get('state')->value;
    $storage = $this->entityTypeManager->getStorage('bb_run');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('state', self::ACTIVE_RUN_STATES, 'IN')
      ->execute();
    $retired = [];
    foreach ($storage->loadMultiple($ids) as $run) {
      if (!$run instanceof BbRunInterface) {
        continue;
      }
      if ((string) $run->get('state_at_start')->value === $state) {
        continue;
      }
      $run->setRunState('done')->save();
      $retired[] = (int) $run->id();
    }
    return $retired;
  }

  /**
   * Validates the ticket state is claimable (and handled by the conductor).
   *
   * The workflow's per-state `claimable` flag is the primary state gate. A
   * conductor may optionally narrow itself to a list of states; an empty list
   * means it serves every claimable state in its project.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to validate.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the claim.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the state is not claimable, or a non-empty conductor state
   *   list does not include it.
   */
  private function assertClaimableState(BbTicketInterface $ticket, BbConductorInterface $conductor): void {
    // Unclassified ticket (no workflow) is claimable by any conductor for the
    // project — qualification assigns the workflow. No state to check.
    if ($ticket->getWorkflow() === '') {
      return;
    }
    $state = (string) $ticket->get('state')->value;
    if (!TypeWorkflows::isClaimable($ticket->getWorkflow(), $state)) {
      throw new ClaimConflictException('claim_conflict: ticket state is not claimable.');
    }
    $states = $conductor->getStates();
    if ($states !== [] && !in_array($state, $states, TRUE)) {
      throw new ClaimConflictException('claim_conflict: conductor does not handle this state.');
    }
  }

  /**
   * Validates that the ticket and conductor belong to the same project.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to validate.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the claim.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the projects differ or the ticket has no project.
   */
  private function assertProjectMatch(BbTicketInterface $ticket, BbConductorInterface $conductor): void {
    $ticket_project = $ticket->getProjectId();
    $conductor_project = $conductor->get('project_id')->target_id;
    if ($ticket_project === NULL || !is_numeric($conductor_project)) {
      throw new ClaimConflictException('claim_conflict: ticket or conductor has no project.');
    }
    if ($ticket_project !== (int) $conductor_project) {
      throw new ClaimConflictException('claim_conflict: conductor project mismatch.');
    }
  }

  /**
   * Enforces the conductor-assignment rule.
   *
   * A classified ticket is claimable only by the conductor it is explicitly
   * assigned to (`conductor_id`). The user assignee (`assignee_user_id`) is
   * human ownership only and plays no part in claiming. Unclassified tickets
   * (no workflow) are handled by the qualification path and are exempt — any
   * conductor for the project may claim them.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to validate.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor requesting the claim.
   *
   * @throws \Drupal\bb_core\Claim\ClaimConflictException
   *   Thrown when the ticket is assigned to no conductor or another conductor.
   */
  private function assertConductorAssignment(BbTicketInterface $ticket, BbConductorInterface $conductor): void {
    // Unclassified tickets (no workflow) are qualification candidates: any
    // conductor for the project may claim them, so no assignment is required.
    if ($ticket->getWorkflow() === '') {
      return;
    }
    $assigned = $ticket->getConductor();
    if ($assigned === NULL) {
      throw new ClaimConflictException('claim_conflict: ticket is not assigned to any conductor.');
    }
    if ((int) $assigned->id() !== (int) $conductor->id()) {
      throw new ClaimConflictException('claim_conflict: ticket is assigned to another conductor.');
    }
  }

}
