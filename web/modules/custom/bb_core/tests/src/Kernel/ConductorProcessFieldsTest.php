<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the two process-identity fields a conductor reports about itself.
 *
 * `last_pid` and `conductor_name` exist so the cockpit can stop a conductor it
 * did not start: the pid identifies the process to signal, the name identifies
 * which config file of the workspace it was started from. Nobody discovers
 * either value — the process that knows reports them on its own registration,
 * which is why they ride the heartbeat payload rather than a second write path.
 *
 * The refresh-on-heartbeat half is the load-bearing one. Registration
 * attributes were previously applied only when the conductor row was created,
 * so a conductor that already existed would have kept a NULL pid forever and
 * could never have been stopped from the UI.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorProcessFieldsTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * The registering machine's UUID.
   */
  private const MACHINE = '9c2e4f60-1b3d-4a5e-8f70-6d5c4b3a2918';

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
    $this->createProject('default-project');
  }

  /**
   * Both fields are declared on the entity with the types the CLI writes.
   */
  public function testBaseFieldsAreDeclared(): void {
    $fields = \Drupal::service('entity_field.manager')
      ->getBaseFieldDefinitions('bb_conductor');

    $this->assertArrayHasKey('last_pid', $fields);
    $this->assertArrayHasKey('conductor_name', $fields);
    $this->assertSame('integer', $fields['last_pid']->getType());
    $this->assertSame('string', $fields['conductor_name']->getType());
  }

  /**
   * A registration carrying both values round-trips them through storage.
   */
  public function testHeartbeatPersistsBothOnCreate(): void {
    $owner = $this->createUser('owner-create');

    $conductor = $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'project' => 'default-project',
      'workspace_root' => '/checkout/.bakers',
      'last_pid' => 4242,
      'conductor_name' => 'shop',
    ]);

    $this->assertSame(4242, (int) $conductor->get('last_pid')->value);
    $this->assertSame('shop', (string) $conductor->get('conductor_name')->value);

    $reloaded = $this->reload($conductor->id());
    $this->assertSame(4242, (int) $reloaded->get('last_pid')->value);
    $this->assertSame('shop', (string) $reloaded->get('conductor_name')->value);
  }

  /**
   * A heartbeat refreshes both on a conductor that already exists.
   *
   * This is what makes the fields usable at all: the row for a long-running
   * conductor is created once and heartbeaten thousands of times, so a value
   * applied only at creation would be permanently NULL in practice.
   */
  public function testHeartbeatRefreshesBothOnExistingConductor(): void {
    $owner = $this->createUser('owner-refresh');

    $first = $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'project' => 'default-project',
      'workspace_root' => '/first/.bakers',
      'last_pid' => 1111,
      'conductor_name' => 'conductor',
    ]);

    $second = $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'project' => 'default-project',
      'workspace_root' => '/second/.bakers',
      'last_pid' => 2222,
      'conductor_name' => 'shop',
    ]);

    $this->assertSame($first->id(), $second->id(), 'The heartbeat must reuse the row, not create a second one.');
    $this->assertSame(2222, (int) $second->get('last_pid')->value);
    $this->assertSame('shop', (string) $second->get('conductor_name')->value);
    $this->assertSame(
      '/second/.bakers',
      (string) $second->get('workspace_root')->value,
      'A restart from a different checkout must move workspace_root, or the cockpit would spawn into the old one.',
    );
  }

  /**
   * A registration omitting both leaves them untouched rather than clearing.
   *
   * `poll` and `reap` build a conductor and heartbeat without owning a serve
   * loop, so they report neither field. They must not wipe the running
   * conductor's pid on their way past.
   */
  public function testHeartbeatWithoutTheFieldsPreservesThem(): void {
    $owner = $this->createUser('owner-preserve');

    $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'project' => 'default-project',
      'last_pid' => 3333,
      'conductor_name' => 'conductor',
    ]);

    $after = $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'project' => 'default-project',
    ]);

    $this->assertSame(3333, (int) $after->get('last_pid')->value);
    $this->assertSame('conductor', (string) $after->get('conductor_name')->value);
  }

  /**
   * A row that never carried the fields reads NULL instead of failing.
   */
  public function testAbsentValuesReadAsNull(): void {
    $owner = $this->createUser('owner-absent');

    $conductor = $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'project' => 'default-project',
    ]);

    $this->assertNull($conductor->get('last_pid')->value);
    $this->assertNull($conductor->get('conductor_name')->value);
  }

  /**
   * A non-numeric pid or non-string name is ignored, not persisted.
   */
  public function testIllTypedValuesAreIgnored(): void {
    $owner = $this->createUser('owner-typed');

    $conductor = $this->registrar()->heartbeat($owner, [
      'machine_id' => self::MACHINE,
      'project' => 'default-project',
      'last_pid' => 'not-a-pid',
      'conductor_name' => ['not', 'a', 'string'],
    ]);

    $this->assertNull($conductor->get('last_pid')->value);
    $this->assertNull($conductor->get('conductor_name')->value);
  }

  /**
   * Reloads a conductor from storage, bypassing the entity static cache.
   */
  private function reload(int|string|null $id): BbConductorInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $storage->resetCache([$id]);
    $conductor = $storage->load($id);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    return $conductor;
  }

  /**
   * Returns the registrar under test.
   */
  private function registrar(): ConductorRegistrar {
    $registrar = \Drupal::service('bb_core.conductor_registrar');
    $this->assertInstanceOf(ConductorRegistrar::class, $registrar);
    return $registrar;
  }

  /**
   * Creates a user account.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    $this->addContributorEverywhere($user);
    return $user;
  }

  /**
   * Creates a project with a workspace chain the registrar can resolve.
   */
  private function createProject(string $name): void {
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
  }

}
