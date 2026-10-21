<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Lock\DatabaseLockBackend;
use Drupal\Core\Lock\LockBackendAbstract;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Covers the server-side heartbeat upsert (self-heal).
 *
 * A heartbeat keys on conductor_id (legacy machine_id alias): it creates the
 * conductor when missing, refreshes lease + reported load, links a machine,
 * and always brings it online.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorRegistrarTest extends KernelTestBase {

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_machine',
      'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createUser('uid1-dummy');
    $this->createProjectWithWorkspace('default-project');
  }

  /**
   * A heartbeat for an unknown conductor_id creates (heals) the conductor.
   */
  public function testHeartbeatCreatesMissingConductor(): void {
    $owner = $this->createUser('owner');

    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-heal',
      'host_key' => 'host-heal',
      'project' => 'default-project',
      'states' => ['diagnose', 'coding'],
      'label' => 'healed',
      'workspace_root' => '/checkout',
      'max_parallel' => 3,
      'current_load' => 1,
      'lease_seconds' => 300,
    ]);

    $this->assertSame('mid-heal', $conductor->getConductorId());
    $this->assertSame('online', $conductor->getStatus());
    $this->assertFalse($conductor->isNew());
    $this->assertGreaterThan(0, (int) $conductor->get('lease_expires_at')->value);
    $this->assertSame(1, (int) $conductor->get('reported_load')->value);
    $this->assertFalse($conductor->hasField('current_load'));
    $this->assertFalse($conductor->hasField('max_parallel'));
    $machine = $conductor->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $this->assertSame('host-heal', $machine->getHostKey());
    $this->assertSame(3, $machine->getMaxParallel());
    $this->assertSame(1, $machine->getCurrentLoad());
  }

  /**
   * Legacy machine_id payload is accepted as conductor_id.
   */
  public function testHeartbeatAcceptsLegacyMachineIdAlias(): void {
    $owner = $this->createUser('owner-legacy');
    $conductor = $this->registrar()->heartbeat($owner, [
      'machine_id' => 'legacy-mid',
      'host_key' => 'host-legacy',
      'project' => 'default-project',
      'current_load' => 2,
      'max_parallel' => 4,
    ]);
    $this->assertSame('legacy-mid', $conductor->getConductorId());
    $this->assertSame(2, (int) $conductor->get('reported_load')->value);
    $this->assertSame(4, $conductor->getMachine()?->getMaxParallel());
  }

  /**
   * A heartbeat for an existing conductor reuses it (no dup) and refreshes it.
   */
  public function testHeartbeatReusesExistingConductor(): void {
    $owner = $this->createUser('owner');
    $attrs = [
      'conductor_id' => 'mid-reuse',
      'host_key' => 'host-reuse',
      'project' => 'default-project',
      'current_load' => 0,
    ];
    $first = $this->registrar()->heartbeat($owner, $attrs);
    $second = $this->registrar()->heartbeat($owner, ['current_load' => 5] + $attrs);

    $this->assertSame($first->id(), $second->id());
    $this->assertSame(5, (int) $second->get('reported_load')->value);
    $this->assertSame(5, $second->getMachine()?->getCurrentLoad());
    $count = $this->container->get('entity_type.manager')->getStorage('bb_conductor')
      ->getQuery()->accessCheck(FALSE)->condition('conductor_id', 'mid-reuse')->count()->execute();
    $this->assertSame(1, (int) $count);
  }

  /**
   * A bound conductor cannot be re-registered from another machine.
   *
   * Another machine means another conductor: the second host is refused
   * before anything is written, so the original binding and loads stay.
   */
  public function testHeartbeatRefusesAnotherMachineForBoundConductor(): void {
    $owner = $this->createUser('owner-rebind');
    $attrs = [
      'conductor_id' => 'bound-cid',
      'host_key' => 'host-original',
      'project' => 'default-project',
      'current_load' => 2,
    ];
    $first = $this->registrar()->heartbeat($owner, $attrs);
    $original = $first->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $original);

    try {
      $this->registrar()->heartbeat($owner, ['host_key' => 'host-other', 'current_load' => 4] + $attrs);
      $this->fail('A second machine re-bound an existing conductor.');
    }
    catch (UnprocessableEntityHttpException $e) {
      $this->assertStringContainsString('another machine', $e->getMessage());
    }

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $reloaded = $storage->loadUnchanged($first->id());
    $this->assertInstanceOf(BbConductorInterface::class, $reloaded);
    $this->assertSame($original->id(), $reloaded->getMachine()?->id());
    $this->assertSame(2, (int) $reloaded->get('reported_load')->value);
    $this->assertSame(2, $reloaded->getMachine()?->getCurrentLoad());
    $other = $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->getQuery()->accessCheck(FALSE)->condition('host_key', 'host-other')->count()->execute();
    $this->assertSame(0, (int) $other);
  }

  /**
   * A registration racing another for the same conductor id writes nothing.
   *
   * The other request holds the registration lock between its read and its
   * save, so this one cannot bind the identity to its own machine meanwhile.
   */
  public function testConcurrentRegistrationOfOneConductorIdIsRefused(): void {
    $owner = $this->createUser('owner-race');
    $other_request = new DatabaseLockBackend($this->container->get('database'));
    self::assertTrue($other_request->acquire('bb_conductor_register:' . $owner->id() . ':race-cid'));

    try {
      // Kernel tests wire a NullLockBackend; this registrar locks for real.
      $registrar = new ConductorRegistrar(
        $this->container->get('entity_type.manager'),
        $this->container->get('datetime.time'),
        new DatabaseLockBackend($this->container->get('database')),
      );
      $registrar->heartbeat($owner, [
        'conductor_id' => 'race-cid',
        'host_key' => 'host-race-b',
        'project' => 'default-project',
      ]);
      $this->fail('A concurrent registration was not refused.');
    }
    catch (ConflictHttpException) {
    }
    finally {
      $other_request->releaseAll();
    }

    $etm = $this->container->get('entity_type.manager');
    $this->assertSame(0, (int) $etm->getStorage('bb_conductor')->getQuery()->accessCheck(FALSE)->condition('conductor_id', 'race-cid')->count()->execute());
    $this->assertSame(0, (int) $etm->getStorage('bb_machine')->getQuery()->accessCheck(FALSE)->condition('host_key', 'host-race-b')->count()->execute());
  }

  /**
   * A same-host registration overlapping a short one waits instead of 409.
   */
  public function testRegistrationWaitsForShortConcurrentOne(): void {
    $owner = $this->createUser('owner-overlap');
    // Held on the first attempt, released before the wait returns.
    $lock = new class() extends LockBackendAbstract {

      /**
       * Acquire attempts so far.
       */
      private int $attempts = 0;

      /**
       * {@inheritdoc}
       */
      public function acquire($name, $timeout = 30.0) {
        return ++$this->attempts > 1;
      }

      /**
       * {@inheritdoc}
       */
      public function lockMayBeAvailable($name) {
        return TRUE;
      }

      /**
       * {@inheritdoc}
       */
      public function release($name): void {}

      /**
       * {@inheritdoc}
       */
      public function releaseAll($lockId = NULL): void {}

    };
    $registrar = new ConductorRegistrar(
      $this->container->get('entity_type.manager'),
      $this->container->get('datetime.time'),
      $lock,
    );

    $conductor = $registrar->heartbeat($owner, [
      'conductor_id' => 'overlap-cid',
      'host_key' => 'host-overlap',
      'project' => 'default-project',
    ]);

    self::assertSame('overlap-cid', $conductor->getConductorId());
  }

  /**
   * A legacy conductor without a machine is bound on its next heartbeat.
   */
  public function testHeartbeatBindsAnUnboundConductor(): void {
    $owner = $this->createUser('owner-legacy');
    $attrs = ['conductor_id' => 'legacy-unbound', 'host_key' => 'host-legacy', 'project' => 'default-project'];
    $conductor = $this->registrar()->heartbeat($owner, $attrs);
    $conductor->set('machine', NULL)->save();

    $again = $this->registrar()->heartbeat($owner, $attrs);

    $this->assertSame('host-legacy', $again->getMachine()?->get('host_key')->value);
  }

  /**
   * A heartbeat brings an offline conductor back online.
   */
  public function testHeartbeatRevivesOffline(): void {
    $owner = $this->createUser('owner');
    $attrs = [
      'conductor_id' => 'mid-revive',
      'host_key' => 'host-revive',
      'project' => 'default-project',
    ];
    $conductor = $this->registrar()->heartbeat($owner, $attrs);
    $conductor->setStatus('offline')->save();

    $revived = $this->registrar()->heartbeat($owner, $attrs);
    $this->assertSame('online', $revived->getStatus());
  }

  /**
   * The same conductor_id owned by different users yields distinct conductors.
   */
  public function testHeartbeatIsScopedToOwner(): void {
    $a = $this->createUser('owner-a');
    $b = $this->createUser('owner-b');
    $attrs = [
      'conductor_id' => 'shared-mid',
      'host_key' => 'shared-host',
      'project' => 'default-project',
    ];

    $ca = $this->registrar()->heartbeat($a, $attrs);
    $cb = $this->registrar()->heartbeat($b, $attrs);

    $this->assertNotSame($ca->id(), $cb->id());
  }

  /**
   * A heartbeat without conductor_id (and no legacy machine_id) is rejected.
   */
  public function testHeartbeatRequiresConductorId(): void {
    $this->expectException(UnprocessableEntityHttpException::class);
    $this->registrar()->heartbeat($this->createUser('owner'), ['project' => 'default-project']);
  }

  /**
   * Creating a conductor for an unknown project is rejected.
   */
  public function testHeartbeatRequiresKnownProjectToCreate(): void {
    $this->expectException(UnprocessableEntityHttpException::class);
    $this->registrar()->heartbeat($this->createUser('owner'), [
      'conductor_id' => 'mid-noproj',
      'host_key' => 'host-noproj',
      'project' => 'does-not-exist',
    ]);
  }

  /**
   * Machine current_load is the sum of online conductors' reported_load.
   */
  public function testMachineLoadAggregatesOnlineConductors(): void {
    $owner = $this->createUser('owner-agg');
    $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'agg-a',
      'host_key' => 'host-agg',
      'project' => 'default-project',
      'current_load' => 2,
      'max_parallel' => 5,
    ]);
    $second = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'agg-b',
      'host_key' => 'host-agg',
      'project' => 'default-project',
      'current_load' => 3,
      'max_parallel' => 5,
    ]);
    $machine = $second->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $this->assertSame(5, $machine->getCurrentLoad());
    $this->assertSame(5, $machine->getMaxParallel());
  }

  /**
   * Registration without a load report leaves an existing reported_load intact.
   */
  public function testRegistrationWithoutLoadPreservesReportedLoad(): void {
    $owner = $this->createUser('owner-preserve-load');
    $attrs = [
      'conductor_id' => 'mid-preserve',
      'host_key' => 'host-preserve',
      'project' => 'default-project',
      'current_load' => 3,
    ];
    $this->registrar()->heartbeat($owner, $attrs);
    $again = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-preserve',
      'host_key' => 'host-preserve',
      'project' => 'default-project',
    ]);
    $this->assertSame(3, (int) $again->get('reported_load')->value);
    $this->assertSame(3, $again->getMachine()?->getCurrentLoad());
  }

  /**
   * An explicit heartbeat of zero clears the stored load.
   */
  public function testExplicitHeartbeatZeroClearsReportedLoad(): void {
    $owner = $this->createUser('owner-zero-load');
    $attrs = [
      'conductor_id' => 'mid-zero',
      'host_key' => 'host-zero',
      'project' => 'default-project',
      'current_load' => 4,
    ];
    $this->registrar()->heartbeat($owner, $attrs);
    $cleared = $this->registrar()->heartbeat($owner, ['current_load' => 0] + $attrs);
    $this->assertSame(0, (int) $cleared->get('reported_load')->value);
    $this->assertSame(0, $cleared->getMachine()?->getCurrentLoad());
  }

  /**
   * A first registration with no load report starts at zero.
   */
  public function testNewRegistrationDefaultsLoadToZero(): void {
    $owner = $this->createUser('owner-default-load');
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-default-load',
      'host_key' => 'host-default-load',
      'project' => 'default-project',
    ]);
    $this->assertSame(0, (int) $conductor->get('reported_load')->value);
  }

  /**
   * Later heartbeats keep owner-edited label, states and active.
   */
  public function testReRegistrationPreservesOwnerEdits(): void {
    $owner = $this->createUser('owner-edits');
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-edits',
      'host_key' => 'host-edits',
      'project' => 'default-project',
      'label' => 'from-cli',
      'states' => ['coding'],
    ]);
    $conductor->set('label', 'owner-label');
    $conductor->set('states', ['diagnose', 'review']);
    $conductor->set('active', FALSE);
    $conductor->save();

    $again = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-edits',
      'host_key' => 'host-edits',
      'project' => 'default-project',
      'label' => 'from-cli-again',
      'states' => ['todo'],
    ]);
    $this->assertSame('owner-label', $again->label());
    $this->assertSame(['diagnose', 'review'], $again->getStates());
    $this->assertFalse((bool) $again->get('active')->value);
  }

  /**
   * Offline zeros load, expires the lease, and recomputes host load.
   */
  public function testOfflineZerosLoadExpiresLeaseAndAggregates(): void {
    $owner = $this->createUser('owner-offline');
    $peer = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-off-peer',
      'host_key' => 'host-off',
      'project' => 'default-project',
      'current_load' => 1,
    ]);
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-off',
      'host_key' => 'host-off',
      'project' => 'default-project',
      'current_load' => 2,
      'lease_seconds' => 300,
    ]);
    $now = $this->container->get('datetime.time')->getRequestTime();
    $this->assertGreaterThan($now, (int) $conductor->get('lease_expires_at')->value);
    $this->assertSame(3, $conductor->getMachine()?->getCurrentLoad());

    $offline = $this->registrar()->offline($conductor);
    $this->assertSame('offline', $offline->getStatus());
    $this->assertSame(0, (int) $offline->get('reported_load')->value);
    $this->assertSame($now, (int) $offline->get('lease_expires_at')->value);
    $this->assertSame(1, $offline->getMachine()?->getCurrentLoad());
    $freshPeer = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->load($peer->id());
    $this->assertInstanceOf(BbConductorInterface::class, $freshPeer);
    $this->assertSame('online', $freshPeer->getStatus());
    $this->assertSame(1, (int) $freshPeer->get('reported_load')->value);
  }

  /**
   * Repeating offline is harmless and does not recreate a vanished row.
   */
  public function testOfflineIsIdempotent(): void {
    $owner = $this->createUser('owner-off-twice');
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-off-twice',
      'host_key' => 'host-off-twice',
      'project' => 'default-project',
      'current_load' => 1,
    ]);
    $first = $this->registrar()->offline($conductor);
    $second = $this->registrar()->offline($first);
    $this->assertSame($first->id(), $second->id());
    $this->assertSame('offline', $second->getStatus());
    $this->assertSame(0, (int) $second->get('reported_load')->value);
  }

  /**
   * Returns the registrar service.
   */
  private function registrar(): ConductorRegistrar {
    return $this->container->get('bb_core.conductor_registrar');
  }

  /**
   * Creates workspace → group → project so machine workspace resolves.
   */
  private function createProjectWithWorkspace(string $name): int {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'ws-' . $name]);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')->getStorage('bb_group')
      ->create(['name' => 'g-' . $name, 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $name, 'group_id' => $group->id()]);
    $project->save();
    return (int) $project->id();
  }

  /**
   * Creates a Drupal user (a conductor owner).
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

}
