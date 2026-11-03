<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Kernel tests for the BbConductorProjectMatch constraint.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorProjectMatchTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'markdown_easy', 'bb_core',
  ];

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
    // uid1 is the superuser; keep it out of the way of the conductor owners.
    $this->createRawUser('uid1-dummy');
    // Validating an entity reference runs an access-checked query through the
    // selection handler, so since BB-305 the acting account needs view
    // access to the target type or the reference reads as "cannot be
    // referenced". These tests are about the project-match constraint, not
    // about read access.
    $this->setUpCurrentUser([], [
      'view bb_conductor', 'view bb_project', 'view bb_ticket',
      // Plus `administer bakers` since BB-318: the workspace read scope
      // narrows every access-checked collection query to the acting
      // account's OG memberships, and reference validation runs one. The
      // type's admin permission is the documented bypass (D7 guard 2) — the
      // right fix for a test whose subject is not read access, and the
      // alternative to inventing a workspace chain it does not otherwise
      // need. The read scope itself is covered by WorkspaceReadScope*Test.
      'administer bakers',
    ]);
  }

  /**
   * A conductor in the ticket's project validates cleanly (AC-3).
   */
  public function testInProjectConductorPasses(): void {
    $projectId = $this->createProject('p1');
    $conductor = $this->createConductor('mid-in', $projectId);
    $ticket = $this->createTicket($projectId);
    $ticket->setConductor($conductor);

    $this->assertCount(0, $ticket->validate()->getByField('conductor_id'));
  }

  /**
   * A conductor in a different project is rejected (AC-1).
   */
  public function testCrossProjectConductorViolates(): void {
    $p1 = $this->createProject('p1');
    $p2 = $this->createProject('p2');
    $conductor = $this->createConductor('mid-foreign', $p2);
    $ticket = $this->createTicket($p1);
    $ticket->setConductor($conductor);

    $this->assertGreaterThan(0, $ticket->validate()->getByField('conductor_id')->count());
  }

  /**
   * A conductor cannot be assigned to a ticket with no project (AC-4).
   */
  public function testConductorWithoutTicketProjectViolates(): void {
    $projectId = $this->createProject('bound');
    $conductor = $this->createConductor('bound', $projectId);
    $ticket = BbTicket::create(['title' => 'Needs project', 'workflow' => 'bb_work']);
    $ticket->setConductor($conductor);

    self::assertGreaterThan(0, $ticket->validate()->getByField('conductor_id')->count());
  }

  /**
   * Clearing / omitting the conductor is always allowed (no-op).
   */
  public function testNoConductorIsNoOp(): void {
    $projectId = $this->createProject('p1');
    $ticket = $this->createTicket($projectId);

    $this->assertCount(0, $ticket->validate()->getByField('conductor_id'));
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
   * Creates a plain Drupal user.
   */
  private function createRawUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a BbConductor bound to the given project.
   */
  private function createConductor(string $machineId, int $projectId): BbConductorInterface {
    // An instance admin owner passes BbConductorOwnerAccess, which
    // ConductorOwnerAccessTest covers; this suite is about project scoping.
    $owner = $this->createUser(['administer bakers'], 'owner-' . $machineId);
    $this->assertInstanceOf(UserInterface::class, $owner);
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'label' => $machineId,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $projectId,
      'states' => ['diagnose', 'coding'],
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates and saves a BbTicket in the given project.
   */
  private function createTicket(int $projectId): BbTicket {
    $ticket = BbTicket::create([
      'title' => 'T',
      'workflow' => 'bb_work',
      'project_id' => $projectId,
    ]);
    $ticket->save();
    return $ticket;
  }

}
