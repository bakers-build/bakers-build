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
 * A heartbeat is authoritative: it finds or (re)creates the machine by its
 * UUID and the owner's conductor by machine + project + variant (healed after
 * a delete/wipe), refreshes its lease timestamps and load, and brings it
 * online. Concurrent-run capacity is written on the machine only.
 */
final class ConductorRegistrar {

  private const DEFAULT_LEASE_SECONDS = 300;

  /**
   * Resolves project / host / workspace from heartbeat attributes.
   */
  private readonly HeartbeatRegistrationResolver $registration;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly LockBackendInterface $lock,
    BbWorkspaceReadScopeInterface $readScope,
    BbRankCapabilityInterface $rankCapability,
    WorkspaceResolverInterface $workspaceResolver,
  ) {
    $this->registration = new HeartbeatRegistrationResolver($entityTypeManager, $readScope, $rankCapability, $workspaceResolver);
  }

  /**
   * Records a heartbeat, creating the conductor (and machine) if needed.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param array<string, mixed> $attrs
   *   Registration attributes: machine_id, machine_label, project, variant,
   *   states, workspace_root, max_parallel, current_load, lease_seconds,
   *   last_pid, conductor_name.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface
   *   The upserted conductor.
   */
  public function heartbeat(AccountInterface $owner, array $attrs): BbConductorInterface {
    $machineId = $this->registration->machineId($attrs);
    $variant = $this->registration->variant($attrs);
    // Resolved on every heartbeat, so an owner who lost access is refused
    // before any write.
    $projectId = $this->registration->projectId($attrs, $owner);
    // One registration per key at a time: between this read and the save
    // below, a concurrent first registration could otherwise create a second
    // conductor for the same key. A short overlap (poll during a tick) waits
    // once before it is refused.
    $lock_name = 'bb_conductor_register:' . $machineId . ':' . $projectId . ':' . $variant;
    if (!$this->lock->acquire($lock_name)
      && ($this->lock->wait($lock_name, 5) || !$this->lock->acquire($lock_name))) {
      throw new ConflictHttpException(sprintf('Conductor "%s" of this machine is being registered concurrently; retry.', $variant));
    }
    try {
      return $this->register($owner, $machineId, $projectId, $variant, $attrs);
    }
    finally {
      $this->lock->release($lock_name);
    }
  }

  /**
   * Upserts the machine and the conductor while holding the key lock.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param string $machineId
   *   The machine UUID.
   * @param int $projectId
   *   Project entity id.
   * @param string $variant
   *   The conductor variant.
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  private function register(AccountInterface $owner, string $machineId, int $projectId, string $variant, array $attrs): BbConductorInterface {
    $machine = $this->loadOrCreateMachine($owner, $machineId, $attrs);
    $machine->save();

    $conductor = $this->load($owner, (int) $machine->id(), $projectId, $variant)
      ?? $this->create($owner, $machine, $projectId, $variant, $attrs);

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
    foreach ($this->refreshableValues($attrs) as $field => $value) {
      $conductor->set($field, $value);
    }
    $conductor->setStatus('online');
    $conductor->save();

    $this->recomputeMachineLoad($machine);
    return $conductor;
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
   * Loads the owner's conductor of that key, or NULL when none exists.
   */
  private function load(AccountInterface $owner, int $machineId, int $projectId, string $variant): ?BbConductorInterface {
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('owner_user_id', $owner->id())
      ->condition('machine', $machineId)
      ->condition('project_id', $projectId)
      ->condition('variant', $variant)
      ->range(0, 1)
      ->execute();
    if ($ids === []) {
      return NULL;
    }
    $conductor = $storage->load(reset($ids));
    return $conductor instanceof BbConductorInterface ? $conductor : NULL;
  }

  /**
   * Creates a conductor; its label is derived here once and never again.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The conductor owner.
   * @param \Drupal\bb_core\Entity\BbMachineInterface $machine
   *   The machine it runs on.
   * @param int $projectId
   *   Project entity id.
   * @param string $variant
   *   The conductor variant.
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  private function create(AccountInterface $owner, BbMachineInterface $machine, int $projectId, string $variant, array $attrs): BbConductorInterface {
    $project = $this->entityTypeManager->getStorage('bb_project')->load($projectId);
    $label = $machine->label() . ' · ' . $project?->label() . ($variant === 'conductor' ? '' : '/' . $variant);
    $values = [
      'label' => $label,
      'variant' => $variant,
      'machine' => $machine->id(),
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
   * Loads or creates the owner's machine and refreshes its name.
   *
   * The budget (`max_parallel`) is set only when the row is first created —
   * from the registering conductor's config, or 1 as a last resort — and is
   * never rewritten by a later heartbeat, so two conductors on one host with
   * different `max_parallel` cannot flip the budget; it changes only through
   * the machine admin form.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The machine owner.
   * @param string $machineId
   *   The machine UUID.
   * @param array<string, mixed> $attrs
   *   Registration attributes: `machine_label`, and `max_parallel` at
   *   creation only.
   *
   * @throws \Symfony\Component\HttpKernel\Exception\ConflictHttpException
   *   When the machine belongs to another user.
   */
  private function loadOrCreateMachine(AccountInterface $owner, string $machineId, array $attrs): BbMachineInterface {
    $label = isset($attrs['machine_label']) && is_string($attrs['machine_label']) && $attrs['machine_label'] !== ''
      ? $attrs['machine_label']
      : NULL;
    $storage = $this->entityTypeManager->getStorage('bb_machine');
    $machines = $storage->loadByProperties(['uuid' => $machineId]);
    $machine = reset($machines);
    if ($machine instanceof BbMachineInterface) {
      if ((int) $machine->get('owner_user_id')->target_id !== (int) $owner->id()) {
        throw new ConflictHttpException('This machine_id belongs to another user; run `bakers init` on this machine.');
      }
      return $label === NULL ? $machine : $machine->setName($label);
    }
    $max_parallel = isset($attrs['max_parallel']) && is_numeric($attrs['max_parallel'])
      ? (int) $attrs['max_parallel']
      : 1;
    $machine = $storage->create([
      'uuid' => $machineId,
      'name' => $label ?? $machineId,
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
