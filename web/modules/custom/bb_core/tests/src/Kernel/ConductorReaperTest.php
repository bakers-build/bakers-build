<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Conductor\ConductorReaper;
use Drupal\bb_core\Entity\BbConductor;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the cron-driven conductor reaper.
 *
 * Liveness is expressed as status + lease_expires_at, never entity deletion.
 * The reaper flips a non-offline conductor whose lease has expired to offline,
 * leaves fresh/future-lease and never-heartbeat conductors untouched, and never
 * deletes anything.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorReaperTest extends KernelTestBase {

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
   * The default project all fixtures belong to.
   */
  private int $projectId;

  /**
   * The current request time.
   */
  private int $now;

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
    $this->now = $this->container->get('datetime.time')->getRequestTime();
  }

  /**
   * An expired lease flips an online conductor to offline.
   */
  public function testReapsStaleConductors(): void {
    $online = $this->createConductor('stale-online', 'online', $this->now - 10);
    $other = $this->createConductor('stale-online-2', 'online', $this->now - 10);

    $reaped = $this->reaper()->reap();

    $this->assertSame(2, $reaped);
    $this->assertSame('offline', $this->reload($online)->getStatus());
    $this->assertSame('offline', $this->reload($other)->getStatus());
  }

  /**
   * A conductor with a future lease stays online (still heartbeating).
   */
  public function testKeepsFreshConductorOnline(): void {
    $fresh = $this->createConductor('fresh', 'online', $this->now + 300);

    $this->assertSame(0, $this->reaper()->reap());
    $this->assertSame('online', $this->reload($fresh)->getStatus());
  }

  /**
   * A conductor that has never heartbeat (no lease) is not reaped.
   */
  public function testIgnoresConductorWithoutLease(): void {
    $noLease = $this->createConductor('no-lease', 'online', NULL);

    $this->assertSame(0, $this->reaper()->reap());
    $this->assertSame('online', $this->reload($noLease)->getStatus());
  }

  /**
   * The reaper never deletes: a stale conductor still exists, just offline.
   */
  public function testNeverDeletes(): void {
    $stale = $this->createConductor('stale', 'online', $this->now - 10);

    $this->reaper()->reap();

    $reloaded = BbConductor::load($stale->id());
    $this->assertInstanceOf(BbConductorInterface::class, $reloaded);
    $this->assertSame('offline', $reloaded->getStatus());
  }

  /**
   * An already-offline stale conductor is left alone (not re-counted).
   */
  public function testSkipsAlreadyOffline(): void {
    $this->createConductor('already-offline', 'offline', $this->now - 10);

    $this->assertSame(0, $this->reaper()->reap());
  }

  /**
   * Returns the reaper service.
   */
  private function reaper(): ConductorReaper {
    return $this->container->get('bb_core.conductor_reaper');
  }

  /**
   * Reloads a conductor fresh from storage.
   */
  private function reload(BbConductorInterface $conductor): BbConductorInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $storage->resetCache([$conductor->id()]);
    $reloaded = $storage->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Creates and saves a BbProject, returning its entity ID.
   */
  private function createProject(string $name): int {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $name]);
    $project->save();
    return (int) $project->id();
  }

  /**
   * Creates a Drupal user (fixture owner for conductors).
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a BbConductor with the given status and lease.
   *
   * @param string $machineId
   *   The unique machine id.
   * @param string $status
   *   The initial status (online|offline).
   * @param int|null $leaseExpiresAt
   *   The lease expiry timestamp, or NULL for a conductor that never heartbeat.
   */
  private function createConductor(string $machineId, string $status, ?int $leaseExpiresAt): BbConductorInterface {
    $owner = $this->createUser('owner-' . $machineId);
    $values = [
      'conductor_id' => $machineId,
      'label' => $machineId,
      'owner_user_id' => $owner->id(),
      'status' => $status,
      'project_id' => $this->projectId,
      'states' => ['diagnose', 'coding'],
    ];
    if ($leaseExpiresAt !== NULL) {
      $values['lease_expires_at'] = $leaseExpiresAt;
      $values['last_seen'] = $leaseExpiresAt - 300;
    }
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create($values);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

}
