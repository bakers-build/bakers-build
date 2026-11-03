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
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Covers the server-side heartbeat upsert (self-heal).
 *
 * A heartbeat keys on machine + project + variant: it creates the machine and
 * the conductor when missing, refreshes lease + reported load, and always
 * brings the conductor online.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorRegistrarTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * The machine UUID most tests register from.
   */
  private const MACHINE = '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30';

  /**
   * The id of the project most tests register for.
   */
  private int $projectId;

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
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_machine',
      'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    $this->createUser('uid1-dummy');
    $this->projectId = $this->createProjectWithWorkspace('default-project');
  }

  /**
   * A first heartbeat creates the machine with the sent UUID and the conductor.
   */
  public function testHeartbeatCreatesMachineAndConductor(): void {
    $owner = $this->createUser('owner');

    $conductor = $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'machine_label' => 'cw-laptop',
      'project' => 'default-project',
      'states' => ['diagnose', 'coding'],
      'workspace_root' => '/checkout',
      'max_parallel' => 3,
      'current_load' => 1,
      'lease_seconds' => 300,
    ]);

    $this->assertSame('conductor', $conductor->getVariant());
    $this->assertSame('cw-laptop · default-project', $conductor->label());
    $this->assertSame('online', $conductor->getStatus());
    $this->assertFalse($conductor->isNew());
    $this->assertGreaterThan(0, (int) $conductor->get('lease_expires_at')->value);
    $this->assertSame(1, (int) $conductor->get('reported_load')->value);
    $this->assertFalse($conductor->hasField('current_load'));
    $this->assertFalse($conductor->hasField('max_parallel'));
    $this->assertFalse($conductor->hasField('conductor_id'));
    $machine = $conductor->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $this->assertSame(self::MACHINE, $machine->uuid());
    $this->assertSame('cw-laptop', $machine->label());
    $this->assertFalse($machine->hasField('host_key'));
    $this->assertSame(3, $machine->getMaxParallel());
    $this->assertSame(1, $machine->getCurrentLoad());
  }

  /**
   * The same machine, project and variant always reach the same conductor.
   */
  public function testHeartbeatReusesConductorOfTheSameKey(): void {
    $owner = $this->createUser('owner');
    $attrs = $this->attrs(['current_load' => 0]);
    $first = $this->registrar()->heartbeat($owner, $attrs);
    $second = $this->registrar()->heartbeat($owner, ['current_load' => 5, 'variant' => 'conductor'] + $attrs);

    $this->assertSame($first->id(), $second->id());
    $this->assertSame(5, (int) $second->get('reported_load')->value);
    $this->assertSame(5, $second->getMachine()?->getCurrentLoad());
    $this->assertSame(1, $this->rows('bb_conductor'));
    $this->assertSame(1, $this->rows('bb_machine'));
  }

  /**
   * Another variant on the same machine and project is a second conductor.
   */
  public function testAnotherVariantRegistersAnotherConductor(): void {
    $owner = $this->createUser('owner');
    $default = $this->registrar()->heartbeat($owner, $this->attrs(['current_load' => 1]));
    $shop = $this->registrar()->heartbeat($owner, $this->attrs(['variant' => 'shop', 'current_load' => 2]));

    $this->assertNotSame($default->id(), $shop->id());
    $this->assertSame('shop', $shop->getVariant());
    $this->assertSame('cw-laptop · default-project/shop', $shop->label());
    $this->assertSame($default->getMachine()?->id(), $shop->getMachine()?->id());
    $this->assertSame(3, $shop->getMachine()?->getCurrentLoad());
    $this->assertSame(2, $this->rows('bb_conductor'));
  }

  /**
   * The machine name follows the label of every heartbeat.
   */
  public function testHeartbeatRefreshesTheMachineName(): void {
    $owner = $this->createUser('owner');
    $this->registrar()->heartbeat($owner, $this->attrs());

    $again = $this->registrar()->heartbeat($owner, $this->attrs(['machine_label' => 'cw-desktop']));

    $this->assertSame('cw-desktop', $again->getMachine()?->label());
    $this->assertSame(1, $this->rows('bb_machine'));
  }

  /**
   * The derived conductor label is set once; an edited label sticks.
   */
  public function testConductorLabelIsDerivedOnceAndKeptAfterAnEdit(): void {
    $owner = $this->createUser('owner');
    $conductor = $this->registrar()->heartbeat($owner, $this->attrs());
    $conductor->set('label', 'Shop runner')->save();

    $again = $this->registrar()->heartbeat($owner, $this->attrs(['machine_label' => 'cw-desktop']));

    $this->assertSame('Shop runner', $again->label());
  }

  /**
   * A machine UUID owned by another user is refused with a conflict.
   */
  public function testForeignMachineIsRefused(): void {
    $this->registrar()->heartbeat($this->createUser('owner-a'), $this->attrs(['current_load' => 2]));

    try {
      $this->registrar()->heartbeat($this->createUser('owner-b'), $this->attrs(['machine_label' => 'stolen']));
      $this->fail('A foreign machine UUID was accepted.');
    }
    catch (ConflictHttpException) {
    }

    $this->assertSame(1, $this->rows('bb_conductor'));
    $machines = $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->loadByProperties(['uuid' => self::MACHINE]);
    $machine = reset($machines);
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $this->assertSame('cw-laptop', $machine->label());
  }

  /**
   * A payload of an old CLI is refused and names `bakers init`.
   *
   * @param array<string, mixed> $attrs
   *   The heartbeat attributes.
   */
  #[DataProvider('staleIdentityProvider')]
  public function testStaleIdentityIsRefused(array $attrs): void {
    try {
      $this->registrar()->heartbeat($this->createUser('owner-stale'), $attrs + ['project' => 'default-project']);
      $this->fail('A stale identity was accepted.');
    }
    catch (UnprocessableEntityHttpException $e) {
      $this->assertStringContainsString('bakers init', $e->getMessage());
    }
    $this->assertSame(0, $this->rows('bb_conductor'));
    $this->assertSame(0, $this->rows('bb_machine'));
  }

  /**
   * Stale or missing identities.
   *
   * @return array<string, array{array<string, mixed>}>
   *   Heartbeat attributes per case.
   */
  public static function staleIdentityProvider(): array {
    return [
      'conductor_id' => [['conductor_id' => 'cw-framework', 'machine_id' => self::MACHINE]],
      'host_key' => [['host_key' => 'cw-laptop', 'machine_id' => self::MACHINE]],
      'non-UUID machine_id' => [['machine_id' => 'cw-laptop']],
      'no machine_id' => [[]],
    ];
  }

  /**
   * A registration racing another for the same key writes nothing.
   *
   * The other request holds the registration lock between its read and its
   * save, so this one cannot create a duplicate conductor meanwhile.
   */
  public function testConcurrentRegistrationOfOneKeyIsRefused(): void {
    $owner = $this->createUser('owner-race');
    $other_request = new DatabaseLockBackend($this->container->get('database'));
    self::assertTrue($other_request->acquire('bb_conductor_register:' . self::MACHINE . ':' . $this->projectId . ':conductor'));

    try {
      // Kernel tests wire a NullLockBackend; this registrar locks for real.
      $registrar = new ConductorRegistrar(
        $this->container->get('entity_type.manager'),
        $this->container->get('datetime.time'),
        new DatabaseLockBackend($this->container->get('database')),
        $this->container->get('bb_core.workspace_read_scope'),
        $this->container->get('bb_core.rank_capability'),
        $this->container->get('bb_core.workspace_resolver'),
      );
      $registrar->heartbeat($owner, $this->attrs());
      $this->fail('A concurrent registration was not refused.');
    }
    catch (ConflictHttpException) {
    }
    finally {
      $other_request->releaseAll();
    }

    $this->assertSame(0, $this->rows('bb_conductor'));
    $this->assertSame(0, $this->rows('bb_machine'));
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
      $this->container->get('bb_core.workspace_read_scope'),
      $this->container->get('bb_core.rank_capability'),
      $this->container->get('bb_core.workspace_resolver'),
    );

    $conductor = $registrar->heartbeat($owner, $this->attrs());

    self::assertFalse($conductor->isNew());
  }

  /**
   * A heartbeat brings an offline conductor back online.
   */
  public function testHeartbeatRevivesOffline(): void {
    $owner = $this->createUser('owner');
    $conductor = $this->registrar()->heartbeat($owner, $this->attrs());
    $conductor->setStatus('offline')->save();

    $revived = $this->registrar()->heartbeat($owner, $this->attrs());
    $this->assertSame('online', $revived->getStatus());
  }

  /**
   * Creating a conductor for an unknown project is rejected.
   */
  public function testHeartbeatRequiresKnownProjectToCreate(): void {
    $this->expectException(UnprocessableEntityHttpException::class);
    $this->registrar()->heartbeat($this->createUser('owner'), $this->attrs(['project' => 'does-not-exist']));
  }

  /**
   * Machine current_load is the sum of online conductors' reported_load.
   */
  public function testMachineLoadAggregatesOnlineConductors(): void {
    $owner = $this->createUser('owner-agg');
    $this->registrar()->heartbeat($owner, $this->attrs(['current_load' => 2, 'max_parallel' => 5]));
    $second = $this->registrar()->heartbeat($owner, $this->attrs([
      'variant' => 'agg-b',
      'current_load' => 3,
      'max_parallel' => 5,
    ]));
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
    $this->registrar()->heartbeat($owner, $this->attrs(['current_load' => 3]));
    $again = $this->registrar()->heartbeat($owner, $this->attrs());
    $this->assertSame(3, (int) $again->get('reported_load')->value);
    $this->assertSame(3, $again->getMachine()?->getCurrentLoad());
  }

  /**
   * An explicit heartbeat of zero clears the stored load.
   */
  public function testExplicitHeartbeatZeroClearsReportedLoad(): void {
    $owner = $this->createUser('owner-zero-load');
    $this->registrar()->heartbeat($owner, $this->attrs(['current_load' => 4]));
    $cleared = $this->registrar()->heartbeat($owner, $this->attrs(['current_load' => 0]));
    $this->assertSame(0, (int) $cleared->get('reported_load')->value);
    $this->assertSame(0, $cleared->getMachine()?->getCurrentLoad());
  }

  /**
   * A first registration with no load report starts at zero.
   */
  public function testNewRegistrationDefaultsLoadToZero(): void {
    $conductor = $this->registrar()->heartbeat($this->createUser('owner-default-load'), $this->attrs());
    $this->assertSame(0, (int) $conductor->get('reported_load')->value);
  }

  /**
   * Later heartbeats keep owner-edited states and active.
   */
  public function testReRegistrationPreservesOwnerEdits(): void {
    $owner = $this->createUser('owner-edits');
    $conductor = $this->registrar()->heartbeat($owner, $this->attrs(['states' => ['coding']]));
    $conductor->set('states', ['diagnose', 'review']);
    $conductor->set('active', FALSE);
    $conductor->save();

    $again = $this->registrar()->heartbeat($owner, $this->attrs(['states' => ['todo']]));
    $this->assertSame(['diagnose', 'review'], $again->getStates());
    $this->assertFalse((bool) $again->get('active')->value);
  }

  /**
   * Offline zeros load, expires the lease, and recomputes host load.
   */
  public function testOfflineZerosLoadExpiresLeaseAndAggregates(): void {
    $owner = $this->createUser('owner-offline');
    $peer = $this->registrar()->heartbeat($owner, $this->attrs(['variant' => 'peer', 'current_load' => 1]));
    $conductor = $this->registrar()->heartbeat($owner, $this->attrs([
      'current_load' => 2,
      'lease_seconds' => 300,
    ]));
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
    $conductor = $this->registrar()->heartbeat($owner, $this->attrs(['current_load' => 1]));
    $first = $this->registrar()->offline($conductor);
    $second = $this->registrar()->offline($first);
    $this->assertSame($first->id(), $second->id());
    $this->assertSame('offline', $second->getStatus());
    $this->assertSame(0, (int) $second->get('reported_load')->value);
  }

  /**
   * Heartbeat attributes of the default machine and project.
   *
   * @param array<string, mixed> $extra
   *   Attributes that override the defaults.
   *
   * @return array<string, mixed>
   *   The heartbeat attributes.
   */
  private function attrs(array $extra = []): array {
    return $extra + [
      'machine_id' => self::MACHINE,
      'machine_label' => 'cw-laptop',
      'project' => 'default-project',
    ];
  }

  /**
   * Counts the rows of an entity type.
   */
  private function rows(string $type): int {
    return (int) $this->container->get('entity_type.manager')->getStorage($type)
      ->getQuery()->accessCheck(FALSE)->count()->execute();
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
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->create(['name' => 't-' . $name, 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $name, 'group_id' => $group->id(), 'teams' => [$team->id()]]);
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
    $this->addContributorEverywhere($user);
    return $user;
  }

}
