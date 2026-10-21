<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Registrar machine upsert and workspace resolution (BB-353 D5/D6).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineRegistrarTest extends KernelTestBase {

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
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createUser('uid1-dummy');
  }

  /**
   * Heartbeat with conductor_id + host_key creates and links a machine.
   */
  public function testHeartbeatCreatesMachineAndLinksConductor(): void {
    $this->seedProjectChain('proj-a');
    $owner = $this->createUser('owner');
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'uid-host-proj-a',
      'host_key' => 'host-a',
      'project' => 'proj-a',
      'max_parallel' => 2,
      'current_load' => 1,
    ]);

    $machine = $conductor->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $this->assertSame('host-a', $machine->getHostKey());
    $this->assertSame((int) $owner->id(), (int) $machine->get('owner_user_id')->target_id);
    $this->assertSame(2, $machine->getMaxParallel());
    $this->assertSame(1, $machine->getCurrentLoad());
    $this->assertFalse($conductor->hasField('max_parallel'));
  }

  /**
   * Capacity is never stored on the conductor entity.
   */
  public function testCapacityNotWrittenOnConductor(): void {
    $this->seedProjectChain('proj-cap');
    $owner = $this->createUser('owner-cap');
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'cap-1',
      'host_key' => 'host-cap',
      'project' => 'proj-cap',
      'max_parallel' => 9,
      'current_load' => 4,
    ]);
    $this->assertFalse($conductor->hasField('max_parallel'));
    $this->assertFalse($conductor->hasField('current_load'));
    $this->assertSame(4, (int) $conductor->get('reported_load')->value);
    $this->assertSame(9, $conductor->getMachine()?->getMaxParallel());
  }

  /**
   * Unresolvable workspace fails registration with 422.
   */
  public function testUnresolvableWorkspaceIsRejected(): void {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'orphan-project']);
    $project->save();

    $this->expectException(UnprocessableEntityHttpException::class);
    $this->registrar()->heartbeat($this->createUser('owner-orphan'), [
      'conductor_id' => 'orphan-mid',
      'host_key' => 'host-orphan',
      'project' => 'orphan-project',
    ]);
  }

  /**
   * Explicit workspace attribute wins over project chain.
   */
  public function testExplicitWorkspaceAttribute(): void {
    $this->seedProjectChain('proj-explicit');
    $other = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'other-ws']);
    $other->save();

    $owner = $this->createUser('owner-explicit');
    $conductor = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'explicit-mid',
      'host_key' => 'host-explicit',
      'project' => 'proj-explicit',
      'workspace' => $other->uuid(),
    ]);
    $machine = $conductor->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $this->assertFalse($machine->hasField('workspace_id'));
  }

  /**
   * Owner-saved host budget survives conflicting local heartbeat values.
   */
  public function testOwnerBudgetSurvivesConflictingConductorHeartbeats(): void {
    $this->seedProjectChain('proj-budget');
    $owner = $this->createUser('owner-budget');
    $first = $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'budget-a',
      'host_key' => 'host-budget',
      'project' => 'proj-budget',
      'max_parallel' => 2,
    ]);
    $machine = $first->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->setMaxParallel(7);
    $machine->save();

    $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'budget-a',
      'host_key' => 'host-budget',
      'project' => 'proj-budget',
      'max_parallel' => 3,
    ]);
    $this->registrar()->heartbeat($owner, [
      'conductor_id' => 'budget-b',
      'host_key' => 'host-budget',
      'project' => 'proj-budget',
      'max_parallel' => 9,
    ]);

    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_machine')->load($machine->id());
    $this->assertInstanceOf(BbMachineInterface::class, $fresh);
    $this->assertSame(7, $fresh->getMaxParallel());
  }

  /**
   * Returns the registrar service.
   */
  private function registrar(): ConductorRegistrar {
    return $this->container->get('bb_core.conductor_registrar');
  }

  /**
   * Seeds workspace → group → project for a project name.
   */
  private function seedProjectChain(string $project_name): void {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'ws-' . $project_name]);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')->getStorage('bb_group')
      ->create(['name' => 'g-' . $project_name, 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $project_name, 'group_id' => $group->id()]);
    $project->save();
  }

  /**
   * Creates a Drupal user.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

}
