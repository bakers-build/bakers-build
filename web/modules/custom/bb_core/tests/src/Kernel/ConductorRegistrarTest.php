<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Lock\DatabaseLockBackend;
use Drupal\Core\Lock\LockBackendAbstract;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Conductor\ConductorTakeoverOffer;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\RoleInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Covers the server-side heartbeat upsert (self-heal).
 *
 * A heartbeat keys on conductor_id and the machine UUID in host_key: it
 * creates the conductor when missing, refreshes lease + reported load, links
 * a machine, and always brings it online.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorRegistrarTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * A machine UUID for fixtures that do not care about the machine.
   */
  private const HOST = '7d3c1a52-0e4b-4f1d-9c2a-5b8e6f4a3d21';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'serialization', 'jsonapi', 'jsonapi_resources',
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
    $this->installConfig(['user', 'jsonapi']);
    $this->installOgScopeFixture();
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
      'host_key' => '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
      'machine_label' => 'cw-laptop',
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
    $this->assertSame('0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', $machine->getHostKey());
    $this->assertSame('cw-laptop', $machine->label());
    $this->assertSame(5, $machine->getMaxParallel());
    $this->assertSame(1, $machine->getCurrentLoad());
  }

  /**
   * A heartbeat from a stale CLI is refused with a pointer to bakers init.
   *
   * @param array<string, mixed> $attrs
   *   Identity attributes of the stale payload.
   */
  #[DataProvider('staleIdentityProvider')]
  public function testHeartbeatRefusesStaleIdentity(array $attrs): void {
    $owner = $this->createUser('owner-stale');
    try {
      $this->registrar()->heartbeat($owner, $attrs + ['project' => 'default-project']);
      $this->fail('A stale identity must be refused.');
    }
    catch (UnprocessableEntityHttpException $e) {
      $this->assertStringContainsString('bakers init', $e->getMessage());
    }
    $this->assertSame(0, (int) $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->getQuery()->accessCheck(FALSE)->count()->execute());
  }

  /**
   * Stale identity payloads.
   *
   * @return array<string, array{array<string, string>}>
   *   Identity attributes per case.
   */
  public static function staleIdentityProvider(): array {
    return [
      'legacy machine_id as conductor' => [['machine_id' => 'cw-framework', 'host_key' => self::HOST]],
      'no host_key' => [['conductor_id' => 'u-framework-bakers']],
    ];
  }

  /**
   * An existing machine keeps its string host key.
   */
  public function testHeartbeatKeepsAnExistingStringHostKey(): void {
    $conductor = $this->registrar()->heartbeat($this->createUser('owner-string'), [
      'conductor_id' => 'cw-framework',
      'host_key' => 'framework',
      'project' => 'default-project',
    ]);
    $this->assertSame('framework', $conductor->getMachine()?->getHostKey());
  }

  /**
   * A new id for a known machine + project + variant is offered for takeover.
   *
   * The 409 names the matching conductor and creates nothing.
   */
  public function testHeartbeatOffersTheMatchingConductorForTakeover(): void {
    $owner = $this->createUser('owner-takeover');
    $old = $this->legacyConductor($owner);
    try {
      $this->registrar()->heartbeat($owner, $this->derivedAttrs());
      $this->fail('A matching conductor must be offered, not duplicated.');
    }
    catch (ConductorTakeoverOffer $e) {
      $this->assertSame(409, $e->getStatusCode());
      $this->assertStringContainsString('--new', $e->getMessage());
      $this->assertSame([[
        'uuid' => $old->uuid(),
        'label' => '',
        'conductor_id' => 'cw-framework',
        'last_seen' => (int) $old->get('last_seen')->value,
      ],
      ], $e->candidates);
    }
    $this->assertSame(1, $this->conductorCount());
  }

  /**
   * The takeover offer reaches the client as a JSON:API 409 over HTTP.
   */
  public function testHeartbeatEndpointAnswersTheOfferWith409(): void {
    $owner = $this->createUser('owner-takeover-http');
    $old = $this->legacyConductor($owner);
    user_role_grant_permissions(RoleInterface::AUTHENTICATED_ID, ['register bakers conductor']);
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $this->container->get('current_user')->setAccount($owner);
    $request = Request::create('/jsonapi/bakers/heartbeat', 'POST', [], [], [], [
      'CONTENT_TYPE' => 'application/vnd.api+json',
      'HTTP_ACCEPT' => 'application/vnd.api+json',
      'HTTP_X_BAKERS_CLIENT' => 'bakers/99.0.0',
    ],
      json_encode(['data' => ['attributes' => $this->derivedAttrs()]], JSON_THROW_ON_ERROR));

    $response = $this->container->get('http_kernel')->handle($request);

    $this->assertSame(409, $response->getStatusCode(), (string) $response->getContent());
    $body = json_decode((string) $response->getContent(), TRUE, 512, JSON_THROW_ON_ERROR);
    $this->assertSame($old->uuid(), $body['errors'][0]['meta']['candidates'][0]['uuid']);
    $this->assertSame(1, $this->conductorCount());
  }

  /**
   * Adopting waits for a heartbeat still running under the conductor's old id.
   *
   * Otherwise an old CLI could save the conductor back under its old id.
   */
  public function testAdoptIsRefusedWhileTheOldIdIsRegistering(): void {
    $owner = $this->createUser('owner-adopt-race');
    $old = $this->legacyConductor($owner);
    $other_request = new DatabaseLockBackend($this->container->get('database'));
    self::assertTrue($other_request->acquire('bb_conductor_register:cw-framework'));
    try {
      $this->lockingRegistrar()->heartbeat($owner, ['adopt' => $old->uuid()] + $this->derivedAttrs());
      $this->fail('Adopting during a registration under the old id was not refused.');
    }
    catch (ConflictHttpException) {
    }
    finally {
      $other_request->releaseAll();
    }
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->loadUnchanged($old->id());
    $this->assertInstanceOf(BbConductorInterface::class, $reloaded);
    $this->assertSame('cw-framework', $reloaded->getConductorId());
  }

  /**
   * Another owner registering the same conductor_id at once is refused.
   *
   * Otherwise both pass the foreign-owner check and one id gets two owners.
   */
  public function testConcurrentRegistrationByAnotherOwnerIsRefused(): void {
    $owner = $this->createUser('owner-same-id');
    $other_request = new DatabaseLockBackend($this->container->get('database'));
    self::assertTrue($other_request->acquire('bb_conductor_register:shared-id'));
    try {
      $this->lockingRegistrar()->heartbeat($owner, [
        'conductor_id' => 'shared-id',
        'host_key' => self::HOST,
        'project' => 'default-project',
      ]);
      $this->fail('A registration under a conductor_id another owner is registering was not refused.');
    }
    catch (ConflictHttpException) {
    }
    finally {
      $other_request->releaseAll();
    }
    $this->assertSame(0, $this->conductorCount());
  }

  /**
   * A conductor that stopped matching before its lock was taken stays as is.
   */
  public function testAdoptIsRefusedWhenTheConductorChangedMeanwhile(): void {
    $owner = $this->createUser('owner-adopt-changed');
    $old = $this->legacyConductor($owner);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    // Another request moves the conductor to variant `shop` just before the
    // old id's lock is granted.
    $lock = new class($storage, (int) $old->id()) extends LockBackendAbstract {

      public function __construct(private readonly EntityStorageInterface $storage, private readonly int $id) {}

      /**
       * {@inheritdoc}
       */
      public function acquire($name, $timeout = 30.0) {
        $conductor = $this->storage->loadUnchanged($this->id);
        if (str_ends_with($name, ':cw-framework') && $conductor instanceof BbConductorInterface) {
          $conductor->set('conductor_name', 'shop')->save();
        }
        return TRUE;
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
    try {
      $registrar->heartbeat($owner, ['adopt' => $old->uuid()] + $this->derivedAttrs());
      $this->fail('A conductor that no longer matches was adopted.');
    }
    catch (ConflictHttpException) {
    }
    $reloaded = $storage->loadUnchanged($old->id());
    $this->assertInstanceOf(BbConductorInterface::class, $reloaded);
    $this->assertSame('cw-framework', $reloaded->getConductorId());
  }

  /**
   * Taking over keeps the conductor and its tickets and moves it to the new id.
   */
  public function testHeartbeatAdoptsTheMatchingConductor(): void {
    $owner = $this->createUser('owner-adopt');
    $old = $this->legacyConductor($owner);
    $adopted = $this->registrar()->heartbeat($owner, ['adopt' => $old->uuid()] + $this->derivedAttrs());
    $this->assertSame($old->id(), $adopted->id());
    $this->assertSame('framework-default-project-conductor', $adopted->getConductorId());
    $this->assertSame(1, $this->conductorCount());
    // Taken over once: the next heartbeat finds it by its new id.
    $again = $this->registrar()->heartbeat($owner, $this->derivedAttrs());
    $this->assertSame($old->id(), $again->id());
  }

  /**
   * Adopting a conductor that is not a match is refused.
   */
  public function testHeartbeatRefusesAdoptingAnotherConductor(): void {
    $owner = $this->createUser('owner-adopt-other');
    $this->legacyConductor($owner);
    $other = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'elsewhere',
      'host_key' => self::HOST,
      'project' => 'default-project',
    ]);
    $this->expectException(UnprocessableEntityHttpException::class);
    $this->registrar()->heartbeat($owner, ['adopt' => $other->uuid()] + $this->derivedAttrs());
  }

  /**
   * Declining the takeover creates a second conductor.
   */
  public function testHeartbeatCreatesAnotherConductorWhenAsked(): void {
    $owner = $this->createUser('owner-new');
    $old = $this->legacyConductor($owner);
    $new = $this->registrar()->heartbeat($owner, ['create_new' => TRUE] + $this->derivedAttrs());
    $this->assertNotSame($old->id(), $new->id());
    $this->assertSame(2, $this->conductorCount());
  }

  /**
   * Another variant is no match, so nothing is asked.
   */
  public function testHeartbeatCreatesAnotherVariantWithoutAsking(): void {
    $owner = $this->createUser('owner-variant');
    $this->legacyConductor($owner);
    $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'framework-default-project-shop',
      'conductor_name' => 'shop',
    ] + $this->derivedAttrs());
    $this->assertSame(2, $this->conductorCount());
  }

  /**
   * The offer for a named variant names the start that selects it.
   */
  public function testVariantOfferNamesItsStart(): void {
    $owner = $this->createUser('owner-variant-offer');
    $shop = ['conductor_name' => 'shop'];
    $old = $this->registrar()->heartbeat($owner, $shop + $this->legacyAttrs());
    $this->expectExceptionMessage('bakers --conductor shop oven start --adopt ' . $old->uuid());
    $this->registrar()->heartbeat($owner, ['conductor_id' => 'framework-default-project-shop'] + $shop + $this->derivedAttrs());
  }

  /**
   * A conductor registered before the upgrade: string id, no variant recorded.
   */
  private function legacyConductor(UserInterface $owner): BbConductorInterface {
    return $this->registrar()->heartbeat($owner, $this->legacyAttrs());
  }

  /**
   * The heartbeat of a conductor registered before the upgrade.
   *
   * @return array<string, string>
   *   Its identity attributes.
   */
  private function legacyAttrs(): array {
    return [
      'conductor_id' => 'cw-framework',
      'host_key' => 'framework',
      'project' => 'default-project',
    ];
  }

  /**
   * A registrar with a real lock; kernel tests wire a NullLockBackend.
   */
  private function lockingRegistrar(): ConductorRegistrar {
    return new ConductorRegistrar(
      $this->container->get('entity_type.manager'),
      $this->container->get('datetime.time'),
      new DatabaseLockBackend($this->container->get('database')),
      $this->container->get('bb_core.workspace_read_scope'),
      $this->container->get('bb_core.rank_capability'),
      $this->container->get('bb_core.workspace_resolver'),
    );
  }

  /**
   * The heartbeat of the upgraded CLI on the same machine.
   *
   * @return array<string, string>
   *   Its identity attributes.
   */
  private function derivedAttrs(): array {
    return [
      'conductor_id' => 'framework-default-project-conductor',
      'host_key' => 'framework',
      'project' => 'default-project',
      'conductor_name' => 'conductor',
    ];
  }

  /**
   * Counts every conductor.
   */
  private function conductorCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('bb_conductor')
      ->getQuery()->accessCheck(FALSE)->count()->execute();
  }

  /**
   * A heartbeat for an existing conductor reuses it (no dup) and refreshes it.
   */
  public function testHeartbeatReusesExistingConductor(): void {
    $owner = $this->createUser('owner');
    $attrs = [
      'conductor_id' => 'mid-reuse',
      'host_key' => 'f4a82708-a5ea-5344-8904-adae5645ac14',
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
      'host_key' => '2f4e9db2-ba15-5f2e-8b14-304b1c8efc4f',
      'project' => 'default-project',
      'current_load' => 2,
    ];
    $first = $this->registrar()->heartbeat($owner, $attrs);
    $original = $first->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $original);

    try {
      $this->registrar()->heartbeat($owner, ['host_key' => '48fa04c8-b79e-5a15-8543-8456988f1349', 'current_load' => 4] + $attrs);
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
      ->getQuery()->accessCheck(FALSE)->condition('host_key', '48fa04c8-b79e-5a15-8543-8456988f1349')->count()->execute();
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
    self::assertTrue($other_request->acquire('bb_conductor_register:race-cid'));

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
      $registrar->heartbeat($owner, [
        'conductor_id' => 'race-cid',
        'host_key' => '5812a68e-1541-57e0-a50e-fabae8fc152b',
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
    $this->assertSame(0, (int) $etm->getStorage('bb_machine')->getQuery()->accessCheck(FALSE)->condition('host_key', '5812a68e-1541-57e0-a50e-fabae8fc152b')->count()->execute());
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

    $conductor = $registrar->heartbeat($owner, [
      'conductor_id' => 'overlap-cid',
      'host_key' => '49c6d47f-8712-5045-816e-bba49ae6dbad',
      'project' => 'default-project',
    ]);

    self::assertSame('overlap-cid', $conductor->getConductorId());
  }

  /**
   * A legacy conductor without a machine is bound on its next heartbeat.
   */
  public function testHeartbeatBindsAnUnboundConductor(): void {
    $owner = $this->createUser('owner-legacy');
    $attrs = [
      'conductor_id' => 'legacy-unbound',
      'host_key' => '420d48cb-0e1e-5e9d-bc96-3834f0e90931',
      'project' => 'default-project',
    ];
    $conductor = $this->registrar()->heartbeat($owner, $attrs);
    $conductor->set('machine', NULL)->save();

    $again = $this->registrar()->heartbeat($owner, $attrs);

    $this->assertSame('420d48cb-0e1e-5e9d-bc96-3834f0e90931', $again->getMachine()?->get('host_key')->value);
  }

  /**
   * A heartbeat brings an offline conductor back online.
   */
  public function testHeartbeatRevivesOffline(): void {
    $owner = $this->createUser('owner');
    $attrs = [
      'conductor_id' => 'mid-revive',
      'host_key' => '7b4867db-d0de-5fa9-b6b6-ba2844a2e0be',
      'project' => 'default-project',
    ];
    $conductor = $this->registrar()->heartbeat($owner, $attrs);
    $conductor->setStatus('offline')->save();

    $revived = $this->registrar()->heartbeat($owner, $attrs);
    $this->assertSame('online', $revived->getStatus());
  }

  /**
   * A conductor_id another user holds is refused, and nothing is created.
   *
   * Derived ids carry no user, so two machines with the same hand-picked
   * machine_id would otherwise share one id across owners.
   */
  public function testHeartbeatRefusesForeignConductorId(): void {
    $attrs = [
      'conductor_id' => 'shared-mid',
      'host_key' => 'framework',
      'project' => 'default-project',
    ];
    $this->registrar()->heartbeat($this->createUser('owner-a'), $attrs);
    try {
      $this->registrar()->heartbeat($this->createUser('owner-b'), $attrs);
      $this->fail('A conductor id of another owner was registered.');
    }
    catch (ConflictHttpException $e) {
      $this->assertStringContainsString('bakers init', $e->getMessage());
    }
    $this->assertSame(1, $this->conductorCount());
  }

  /**
   * A machine still named after its host key takes the label it sends.
   *
   * A name someone has given it stays.
   */
  public function testHeartbeatNamesAnUnnamedMachineFromItsLabel(): void {
    $owner = $this->createUser('owner-label');
    $machine = $this->legacyConductor($owner)->getMachine();
    $this->assertSame('framework', $machine?->label());

    $named = $this->registrar()->heartbeat($owner, ['machine_label' => 'cw-laptop'] + $this->legacyAttrs())->getMachine();
    $this->assertSame('cw-laptop', $named?->label());

    $named->set('name', 'Desk')->save();
    $kept = $this->registrar()->heartbeat($owner, ['machine_label' => 'other'] + $this->legacyAttrs())->getMachine();
    $this->assertSame('Desk', $kept?->label());
  }

  /**
   * A machine label longer than the name field is cut to fit.
   */
  public function testHeartbeatCutsAnOverlongMachineLabel(): void {
    $owner = $this->createUser('owner-long-label');
    $machine = $this->registrar()->heartbeat($owner, ['machine_label' => str_repeat('ä', 300)] + $this->legacyAttrs())->getMachine();
    $this->assertSame(str_repeat('ä', 255), $machine?->label());
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
      'host_key' => 'aeee0147-dd6e-5305-983a-6661dfd66529',
      'project' => 'does-not-exist',
    ]);
  }

  /**
   * An unknown workspace answers like a known one, so names cannot be probed.
   */
  public function testHeartbeatAnswersUnknownWorkspaceLikeUnknownProject(): void {
    $owner = $this->createUser('owner-probe');
    $answer = function (array $workspace) use ($owner): string {
      try {
        $this->registrar()->heartbeat($owner, [
          'conductor_id' => 'mid-probe',
          'host_key' => 'aeee0147-dd6e-5305-983a-6661dfd66529',
          'project' => 'does-not-exist',
        ] + $workspace);
      }
      catch (UnprocessableEntityHttpException $e) {
        return $e->getMessage();
      }
      self::fail('The heartbeat was accepted.');
    };
    $known = $answer(['workspace' => 'ws-default-project']);
    self::assertSame('bakers.build project "does-not-exist" not found.', $known);
    self::assertSame($known, $answer(['workspace' => 'no-such-workspace']));
    self::assertSame($known, $answer(['workspace_id' => 99999]));
  }

  /**
   * Machine current_load is the sum of online conductors' reported_load.
   */
  public function testMachineLoadAggregatesOnlineConductors(): void {
    $owner = $this->createUser('owner-agg');
    $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'agg-a',
      'host_key' => 'f6135178-679a-5895-8e2c-ea8fc71a30f0',
      'project' => 'default-project',
      'current_load' => 2,
      'max_parallel' => 5,
    ]);
    $second = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'agg-b',
      'host_key' => 'f6135178-679a-5895-8e2c-ea8fc71a30f0',
      'project' => 'default-project',
      // A second conductor of one machine and project is another variant.
      'conductor_name' => 'shop',
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
      'host_key' => 'ae32e548-a723-5d3b-842d-8c21111ff9da',
      'project' => 'default-project',
      'current_load' => 3,
    ];
    $this->registrar()->heartbeat($owner, $attrs);
    $again = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-preserve',
      'host_key' => 'ae32e548-a723-5d3b-842d-8c21111ff9da',
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
      'host_key' => 'ef16f14d-5b74-524c-92ab-5de38ca1278f',
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
      'host_key' => 'bfe05794-cab7-54d1-b5c7-043553eeacb2',
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
      'host_key' => '719b5bdc-5aad-57a8-962b-d7dce413feb3',
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
      'host_key' => '719b5bdc-5aad-57a8-962b-d7dce413feb3',
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
      'host_key' => '065bec2b-5b04-59ee-a96f-6f0eb12bcafd',
      'project' => 'default-project',
      'current_load' => 1,
    ]);
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'mid-off',
      'host_key' => '065bec2b-5b04-59ee-a96f-6f0eb12bcafd',
      'project' => 'default-project',
      'conductor_name' => 'shop',
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
      'host_key' => '2673ed73-b4c0-565f-b6eb-a34973d31a9f',
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
