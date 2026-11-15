<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Entity\BbConductor;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachine;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Form\BbEntityDetailCardForm;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the machine and conductor `assignment` setting.
 *
 * The conductor's own value wins unless it defers to its machine.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorAssignmentSettingTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  private const HOST_KEY = '63655f9e-904a-5f43-92cc-c48a75ae7eae';

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
   * New machines forbid; new conductors defer to their machine.
   */
  public function testDefaults(): void {
    $conductor = $this->heartbeat($this->createUser('owner'));
    $machine = $conductor->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);

    $this->assertSame('forbid', $machine->getAssignment());
    $this->assertSame('machine', $conductor->getAssignment());
    $this->assertSame(['value' => 'forbid', 'source' => 'machine'], $conductor->getEffectiveAssignment());
  }

  /**
   * The effective value for every conductor and machine pair.
   */
  #[DataProvider('precedenceProvider')]
  public function testPrecedence(string $conductor_value, string $machine_value, string $value, string $source): void {
    $conductor = $this->heartbeat($this->createUser('owner'));
    $conductor->getMachine()?->set('assignment', $machine_value)->save();
    $conductor->set('assignment', $conductor_value)->save();

    $this->assertSame(['value' => $value, 'source' => $source], $conductor->getEffectiveAssignment());
    $this->assertSame("$value ($source)", $conductor->get('assignment_effective')->value);
  }

  /**
   * Conductor value, machine value, effective value, source.
   *
   * @return array<string, list<string>>
   *   The six pairs.
   */
  public static function precedenceProvider(): array {
    return [
      'machine/allow' => ['machine', 'allow', 'allow', 'machine'],
      'machine/forbid' => ['machine', 'forbid', 'forbid', 'machine'],
      'allow/allow' => ['allow', 'allow', 'allow', 'conductor'],
      'allow/forbid' => ['allow', 'forbid', 'allow', 'conductor'],
      'forbid/allow' => ['forbid', 'allow', 'forbid', 'conductor'],
      'forbid/forbid' => ['forbid', 'forbid', 'forbid', 'conductor'],
    ];
  }

  /**
   * A conductor without a machine resolves to forbid from the machine.
   */
  public function testWithoutMachine(): void {
    $conductor = $this->heartbeat($this->createUser('owner'));
    $conductor->set('machine', NULL);

    $this->assertSame(['value' => 'forbid', 'source' => 'machine'], $conductor->getEffectiveAssignment());
  }

  /**
   * A heartbeat never writes the setting, so re-registration keeps it.
   */
  public function testReRegistrationKeepsAllow(): void {
    $owner = $this->createUser('owner');
    $conductor = $this->heartbeat($owner);
    $machine = $conductor->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->set('assignment', 'allow')->save();
    $conductor->set('assignment', 'allow')->save();

    $again = $this->heartbeat($owner, ['assignment' => 'forbid']);

    $this->container->get('entity_type.manager')->getStorage('bb_machine')->resetCache();
    $this->assertSame($conductor->id(), $again->id());
    $this->assertSame('allow', $again->getAssignment());
    $this->assertSame('allow', BbMachine::load($machine->id())?->getAssignment());
  }

  /**
   * Only the owner may edit either setting; the cards offer both.
   */
  public function testOnlyTheOwnerMayEdit(): void {
    $owner = $this->createUser('owner');
    $peer = $this->createUser('peer');
    $conductor = $this->heartbeat($owner);
    $machine = $conductor->getMachine();
    $this->assertInstanceOf(BbMachineInterface::class, $machine);

    foreach ([$conductor, $machine] as $entity) {
      $this->assertTrue($entity->get('assignment')->access('edit', $owner), $entity->getEntityTypeId());
      $this->assertFalse($entity->get('assignment')->access('edit', $peer), $entity->getEntityTypeId());
    }
    $this->assertFalse($conductor->get('assignment_effective')->access('edit', $owner));

    $this->assertContains('assignment', BbEntityDetailCardForm::fields('bb_machine', 'identity')['edit'] ?? []);
    $this->assertContains('assignment', BbEntityDetailCardForm::fields('bb_conductor', 'identity')['edit'] ?? []);
    $this->assertContains('assignment_effective', BbEntityDetailCardForm::fields('bb_conductor', 'identity')['show'] ?? []);
  }

  /**
   * The update installs the columns; the post-update fills existing rows.
   */
  public function testUpdates(): void {
    $conductor = $this->heartbeat($this->createUser('owner'));
    $machine_id = $conductor->getMachine()?->id();
    $updates = $this->container->get('entity.definition_update_manager');
    foreach (['bb_machine', 'bb_conductor'] as $type) {
      $updates->uninstallFieldStorageDefinition($updates->getFieldStorageDefinition('assignment', $type));
    }

    $this->container->get('module_handler')->loadInclude('bb_core', 'install');
    bb_core_update_11002();
    foreach (['bb_machine', 'bb_conductor'] as $type) {
      $this->assertNotNull($updates->getFieldStorageDefinition('assignment', $type), $type);
    }
    require_once __DIR__ . '/../../../bb_core.post_update.php';
    bb_core_post_update_conductor_assignment();

    $manager = $this->container->get('entity_type.manager');
    $manager->getStorage('bb_machine')->resetCache();
    $manager->getStorage('bb_conductor')->resetCache();
    $this->assertSame('allow', BbMachine::load($machine_id)?->getAssignment());
    $this->assertSame('machine', BbConductor::load($conductor->id())?->getAssignment());
  }

  /**
   * Registers the owner's conductor through the heartbeat.
   *
   * @param \Drupal\user\UserInterface $owner
   *   The conductor owner.
   * @param array<string, mixed> $extra
   *   Extra registration attributes.
   */
  private function heartbeat(UserInterface $owner, array $extra = []): BbConductorInterface {
    $registrar = \Drupal::service('bb_core.conductor_registrar');
    $this->assertInstanceOf(ConductorRegistrar::class, $registrar);
    return $registrar->heartbeat($owner, $extra + [
      'conductor_id' => 'mid-' . $owner->getAccountName(),
      'host_key' => self::HOST_KEY,
      'project' => 'default-project',
    ]);
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
    $manager = $this->container->get('entity_type.manager');
    $workspace = $manager->getStorage('bb_workspace')->create(['name' => 'ws-' . $name]);
    $workspace->save();
    $group = $manager->getStorage('bb_group')->create(['name' => 'g-' . $name, 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $manager->getStorage('bb_team')->create(['name' => 't-' . $name, 'workspace_id' => $workspace->id()]);
    $team->save();
    $manager->getStorage('bb_project')
      ->create(['name' => $name, 'group_id' => $group->id(), 'teams' => [$team->id()]])
      ->save();
  }

}
