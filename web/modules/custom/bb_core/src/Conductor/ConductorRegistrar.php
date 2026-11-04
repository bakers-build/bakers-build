<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Upserts a conductor registration on heartbeat — server-side self-heal.
 *
 * A heartbeat is authoritative: it (re)creates the owner's conductor by
 * conductor_id if it is missing (healed after a delete/wipe), refreshes its
 * lease timestamps and load, links it to a bb_machine host row, and brings
 * it online. Concurrent-run capacity is written on the machine only.
 */
final class ConductorRegistrar {

  private const DEFAULT_LEASE_SECONDS = 300;

  /**
   * Resolves project / host / workspace from heartbeat attributes.
   */
  private readonly HeartbeatRegistrationResolver $registration;

  /**
   * Maps a new conductor_id onto an existing conductor, or refuses it.
   */
  private readonly ConductorTakeover $takeover;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly LockBackendInterface $lock,
    BbWorkspaceReadScopeInterface $readScope,
    BbRankCapabilityInterface $rankCapability,
    WorkspaceResolverInterface $workspaceResolver,
  ) {
    $this->registration = new HeartbeatRegistrationResolver($entityTypeManager, $readScope, $rankCapability, $workspaceResolver);
    $this->takeover = new ConductorTakeover($entityTypeManager);
  }

  /**
   * Records a heartbeat, creating the conductor (and machine) if needed.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param array<string, mixed> $attrs
   *   Registration attributes: conductor_id, host_key (the machine_id),
   *   machine_label, project, states, label, workspace_root, max_parallel,
   *   current_load, lease_seconds, last_pid, conductor_name.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface
   *   The upserted conductor.
   */
  public function heartbeat(AccountInterface $owner, array $attrs): BbConductorInterface {
    $conductorId = $this->registration->conductorId($attrs);
    $hostKey = $this->registration->hostKey($attrs);
    // Resolved on every heartbeat, so an owner who lost access is refused
    // before any write.
    $projectId = $this->registration->projectId($attrs, $owner);
    return $this->locked($owner, $conductorId, fn () => $this->register($owner, $conductorId, $hostKey, $projectId, $attrs));
  }

  /**
   * Runs one registration step while holding the lock for a conductor_id.
   *
   * Between a read and its save, a concurrent registration from another host
   * could otherwise bind the identity to its own machine. A short overlap
   * (poll during a tick) waits once before it is refused.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param string $conductorId
   *   The registration key to lock.
   * @param callable(): \Drupal\bb_core\Entity\BbConductorInterface $step
   *   The step to run under the lock.
   */
  private function locked(AccountInterface $owner, string $conductorId, callable $step): BbConductorInterface {
    $lock_name = 'bb_conductor_register:' . $owner->id() . ':' . $conductorId;
    if (!$this->lock->acquire($lock_name)
      && ($this->lock->wait($lock_name, 5) || !$this->lock->acquire($lock_name))) {
      throw new ConflictHttpException(sprintf('Conductor "%s" is being registered concurrently; retry.', $conductorId));
    }
    try {
      return $step();
    }
    finally {
      $this->lock->release($lock_name);
    }
  }

  /**
   * Finds, takes over or creates the conductor for a registration.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param string $conductorId
   *   Registration key.
   * @param string $hostKey
   *   The registering host.
   * @param int $projectId
   *   Project entity id.
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  private function register(AccountInterface $owner, string $conductorId, string $hostKey, int $projectId, array $attrs): BbConductorInterface {
    $existing = $this->load($owner, $conductorId);
    if ($existing === NULL) {
      $this->takeover->refuseForeignConductorId($owner, $conductorId);
      $match = $this->takeover->match($owner, $hostKey, $projectId, $attrs);
      if ($match !== NULL) {
        // An old CLI may still heartbeat under the adopted conductor's old id.
        return $this->locked($owner, (string) $match->get('conductor_id')->value, function () use ($owner, $match, $conductorId, $hostKey, $projectId, $attrs) {
          $fresh = $this->entityTypeManager->getStorage('bb_conductor')->loadUnchanged($match->id());
          if (!$fresh instanceof BbConductorInterface) {
            throw new ConflictHttpException('The conductor to take over was deleted; retry.');
          }
          $fresh->set('conductor_id', $conductorId);
          return $this->upsert($owner, $fresh, $conductorId, $hostKey, $projectId, $attrs);
        });
      }
    }
    return $this->upsert($owner, $existing, $conductorId, $hostKey, $projectId, $attrs);
  }

  /**
   * Upserts the conductor and its machine while holding the identity lock.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param \Drupal\bb_core\Entity\BbConductorInterface|null $existing
   *   The conductor to refresh, or NULL to create one.
   * @param string $conductorId
   *   Registration key.
   * @param string $hostKey
   *   The registering host.
   * @param int $projectId
   *   Project entity id.
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  private function upsert(AccountInterface $owner, ?BbConductorInterface $existing, string $conductorId, string $hostKey, int $projectId, array $attrs): BbConductorInterface {
    if ($existing !== NULL) {
      $this->refuseRebinding($owner, $existing, $hostKey, $projectId, (string) $attrs['project']);
    }
    $machine = $this->loadOrCreateMachine($owner, $hostKey, $attrs);
    $machine->save();

    $conductor = $existing ?? $this->create($owner, $conductorId, $projectId, $attrs);

    $now = $this->time->getRequestTime();
    $lease = isset($attrs['lease_seconds']) && is_numeric($attrs['lease_seconds'])
      ? (int) $attrs['lease_seconds']
      : self::DEFAULT_LEASE_SECONDS;

    $conductor->set('last_seen', $now);
    $conductor->set('lease_expires_at', $now + $lease);
    // Telemetry only — capacity SoT is bb_machine. A registration that
    // omits current_load must not overwrite a live process's reported load;
    // an explicit zero still clears it. New rows start at zero.
    if (array_key_exists('current_load', $attrs) && is_numeric($attrs['current_load'])) {
      $conductor->set('reported_load', (int) $attrs['current_load']);
    }
    elseif ($conductor->isNew()) {
      $conductor->set('reported_load', 0);
    }
    $conductor->set('machine', $machine->id());
    foreach ($this->refreshableValues($attrs) as $field => $value) {
      $conductor->set($field, $value);
    }
    $conductor->setStatus('online');
    $conductor->save();

    $this->recomputeMachineLoad($machine);
    return $conductor;
  }

  /**
   * Refuses a heartbeat that would rebind an existing conductor.
   *
   * Runs before any write so the established binding, its history and the
   * loads stay untouched.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $existing
   *   The owner's conductor for this conductor_id.
   * @param string $hostKey
   *   The registering host.
   * @param int $projectId
   *   The project resolved for the heartbeat.
   * @param string $project
   *   The project name the heartbeat sent.
   */
  private function refuseRebinding(AccountInterface $owner, BbConductorInterface $existing, string $hostKey, int $projectId, string $project): void {
    // Access was checked for the named project only; a conductor moved to
    // another project keeps heartbeating only while its owner may use that one.
    $stored = (int) $existing->get('project_id')->target_id;
    if ($stored !== $projectId && !$this->registration->mayRegister($owner, $stored)) {
      throw $this->registration->notFound($project);
    }
    // Another machine means another conductor.
    $bound = $existing->getMachine();
    if ($bound !== NULL && (string) $bound->get('host_key')->value !== $hostKey) {
      throw new UnprocessableEntityHttpException(sprintf(
        'Conductor "%s" is bound to another machine; register this machine with another conductor id.',
        $existing->get('conductor_id')->value,
      ));
    }
  }

  /**
   * Marks a conductor offline and recomputes its host aggregate.
   *
   * Does not create a conductor. Repeating the call keeps the row offline
   * with a zero load and a lease that expires at the current request time.
   */
  public function offline(BbConductorInterface $conductor): BbConductorInterface {
    $conductor->setStatus('offline');
    $conductor->set('lease_expires_at', $this->time->getRequestTime());
    $conductor->set('reported_load', 0);
    $conductor->save();
    $machine = $conductor->getMachine();
    if ($machine instanceof BbMachineInterface) {
      $this->recomputeMachineLoad($machine);
    }
    return $conductor;
  }

  /**
   * Loads the owner's conductor by conductor_id, or NULL when none exists.
   */
  private function load(AccountInterface $owner, string $conductorId): ?BbConductorInterface {
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('owner_user_id', $owner->id())
      ->condition('conductor_id', $conductorId)
      ->range(0, 1)
      ->execute();
    if ($ids === []) {
      return NULL;
    }
    $conductor = $storage->load(reset($ids));
    return $conductor instanceof BbConductorInterface ? $conductor : NULL;
  }

  /**
   * Creates (heals) a conductor from the heartbeat's registration attributes.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The conductor owner.
   * @param string $conductorId
   *   Registration key.
   * @param int $projectId
   *   Project entity id.
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  private function create(AccountInterface $owner, string $conductorId, int $projectId, array $attrs): BbConductorInterface {
    $values = [
      'conductor_id' => $conductorId,
      'owner_user_id' => $owner->id(),
      'project_id' => $projectId,
      'status' => 'online',
    ] + $this->optionalConductorValues($attrs);
    $conductor = $this->entityTypeManager->getStorage('bb_conductor')->create($values);
    if (!$conductor instanceof BbConductorInterface) {
      throw new UnprocessableEntityHttpException('Could not create conductor.');
    }
    return $conductor;
  }

  /**
   * Loads or creates the owner's machine for a host_key.
   *
   * The budget (`max_parallel`) is set only when the row is first created —
   * from the registering conductor's config, or 1 as a last resort — and is
   * never rewritten by a later heartbeat, so two conductors on one host with
   * different `max_parallel` cannot flip the budget; it changes only through
   * the machine admin form.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The machine owner.
   * @param string $hostKey
   *   The machine_id from machine.config.js.
   * @param array<string, mixed> $attrs
   *   Registration attributes: `max_parallel` at creation only;
   *   `machine_label` at creation and while the name is still the host key.
   */
  private function loadOrCreateMachine(AccountInterface $owner, string $hostKey, array $attrs): BbMachineInterface {
    $label = is_string($attrs['machine_label'] ?? NULL) ? trim($attrs['machine_label']) : '';
    $storage = $this->entityTypeManager->getStorage('bb_machine');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('owner_user_id', $owner->id())
      ->condition('host_key', $hostKey)
      ->range(0, 1)
      ->execute();
    if ($ids !== []) {
      $machine = $storage->load(reset($ids));
      if ($machine instanceof BbMachineInterface) {
        // A machine registered before it had a label is named after its key.
        if ($label !== '' && $machine->label() === $hostKey) {
          $machine->set('name', $label);
        }
        return $machine;
      }
    }
    $max_parallel = isset($attrs['max_parallel']) && is_numeric($attrs['max_parallel'])
      ? (int) $attrs['max_parallel']
      : 1;
    $machine = $storage->create([
      'name' => $label !== '' ? $label : $hostKey,
      'host_key' => $hostKey,
      'owner_user_id' => $owner->id(),
      'max_parallel' => $max_parallel,
      'current_load' => 0,
    ]);
    if (!$machine instanceof BbMachineInterface) {
      throw new UnprocessableEntityHttpException('Could not create machine.');
    }
    return $machine;
  }

  /**
   * Sums reported_load of online conductors on this machine into current_load.
   */
  private function recomputeMachineLoad(BbMachineInterface $machine): void {
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('machine', $machine->id())
      ->condition('status', 'online')
      ->execute();
    $sum = 0;
    foreach ($storage->loadMultiple($ids) as $conductor) {
      if ($conductor instanceof BbConductorInterface) {
        $sum += (int) $conductor->get('reported_load')->value;
      }
    }
    $machine->setCurrentLoad($sum);
    $machine->save();
  }

  /**
   * Extracts optional create-time conductor attributes (no capacity fields).
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   *
   * @return array<string, mixed>
   *   Values safe to pass to entity create.
   */
  private function optionalConductorValues(array $attrs): array {
    $values = [];
    if (isset($attrs['label']) && is_string($attrs['label'])) {
      $values['label'] = $attrs['label'];
    }
    if (isset($attrs['workspace_root']) && is_string($attrs['workspace_root'])) {
      $values['workspace_root'] = $attrs['workspace_root'];
    }
    if (isset($attrs['states']) && is_array($attrs['states'])) {
      $values['states'] = array_values(array_filter($attrs['states'], 'is_string'));
    }
    return $values + $this->refreshableValues($attrs);
  }

  /**
   * Extracts attributes a heartbeat refreshes on an existing conductor.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   *
   * @return array<string, mixed>
   *   Values applied on every heartbeat.
   */
  private function refreshableValues(array $attrs): array {
    $values = [];
    if (isset($attrs['workspace_root']) && is_string($attrs['workspace_root'])) {
      $values['workspace_root'] = $attrs['workspace_root'];
    }
    if (isset($attrs['last_pid']) && is_numeric($attrs['last_pid'])) {
      $values['last_pid'] = (int) $attrs['last_pid'];
    }
    if (isset($attrs['conductor_name']) && is_string($attrs['conductor_name'])) {
      $values['conductor_name'] = $attrs['conductor_name'];
    }
    return $values;
  }

}
