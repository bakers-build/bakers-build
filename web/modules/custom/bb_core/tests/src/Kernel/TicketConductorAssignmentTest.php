<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the conductor-assignment run trigger.
 *
 * Run start is driven by the ticket's `conductor_id`, not by the human user
 * assignee. This test locks in the acceptance criteria: assigning a conductor
 * makes a classified ticket claimable, assigning only a user does not, and
 * unclassified tickets stay claimable by any conductor for qualification (the
 * workflow-less claim path).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketConductorAssignmentTest extends KernelTestBase {

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
  }

  /**
   * Verifies the conductor_id field stores and reads back a conductor.
   */
  public function testConductorIdFieldStoresAndReads(): void {
    $conductor = $this->createConductor('mid-1');
    $ticket = BbTicket::create([
      'title' => 'T',
      'workflow' => 'bb_feature',
      'project_id' => $this->projectId,
    ]);
    $ticket->setConductor($conductor);
    $ticket->save();

    $reloaded = BbTicket::load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->assertSame($conductor->id(), $reloaded->getConductor()->id());
  }

  /**
   * Verifies a ticket assigned to a conductor is claimable by that conductor.
   */
  public function testTicketAssignedToConductorIsClaimable(): void {
    $conductor = $this->createConductor('mid-claim');
    $ticket = $this->createActiveTicket('GL-CA1');
    $ticket->setConductor($conductor)->save();

    $run = $this->claim()->claimNext($conductor, 300);
    $this->assertNotNull($run);
    $this->assertSame((int) $ticket->id(), $run->getTicketId());
  }

  /**
   * Verifies assigning only a human user does not start a run.
   */
  public function testTicketAssignedOnlyToUserIsNotClaimable(): void {
    $conductor = $this->createConductor('mid-user');
    $human = $this->createUser('human');
    $ticket = $this->createActiveTicket('GL-CA2');
    // A user assignee but no conductor_id — must not be claimable.
    $ticket->set('assignee_user_id', $human->id())->save();

    $this->assertNull($this->claim()->claimNext($conductor, 300));
  }

  /**
   * Verifies assigning a conductor preserves the existing human owner.
   *
   * The user assignee (`assignee_user_id`) is independent human ownership:
   * assigning a conductor must never clear or overwrite it.
   */
  public function testAssigningConductorKeepsUserOwner(): void {
    $conductor = $this->createConductor('mid-keep-owner');
    $human = $this->createUser('owner-human');
    $ticket = $this->createActiveTicket('GL-CA-KEEP');
    $ticket->set('assignee_user_id', $human->id())->save();

    // Now assign a conductor — the human owner must remain untouched.
    $ticket->setConductor($conductor)->save();

    $reloaded = BbTicket::load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->assertSame((int) $human->id(), (int) $reloaded->get('assignee_user_id')->target_id);
    $this->assertSame($conductor->id(), $reloaded->getConductor()->id());
  }

  /**
   * Unclassified tickets stay claimable by any conductor for qualification.
   */
  public function testUnclassifiedTicketIsClaimableByAnyConductorForQualification(): void {
    $conductor = $this->createConductor('mid-qualification', ['coding']);
    // Unclassified: no workflow, no conductor_id.
    $ticket = BbTicket::create([
      'identifier' => 'GL-CA3',
      'title' => 'qualify me',
      'project_id' => $this->projectId,
    ]);
    $ticket->save();

    $run = $this->claim()->claimNext($conductor, 300);
    $this->assertNotNull($run);
    $this->assertSame((int) $ticket->id(), $run->getTicketId());
  }

  /**
   * Returns the TicketClaimService from the container.
   */
  private function claim(): TicketClaimService {
    return $this->container->get('bb_core.ticket_claim');
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
   * Creates a Drupal user with conductor registration and claim permissions.
   */
  private function createConductorUser(string $name): UserInterface {
    $role_id = 'conductor_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, ['register bakers conductor', 'claim bakers tickets']);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a plain Drupal user without special permissions.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a BbConductor for the shared project and given states.
   */
  private function createConductor(string $machineId, array $states = ['diagnose', 'coding']): BbConductorInterface {
    $owner = $this->createConductorUser('owner-' . $machineId);
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $machineId,
      'label' => $machineId,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $this->projectId,
      'states' => $states,
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates a saved classified ticket in its claimable work entry state.
   *
   * The bb_bug workflow now enters 'qualification' first (BB-196); this
   * advances to the 'diagnose' entry state handled by the default conductor
   * states.
   */
  private function createActiveTicket(string $identifier): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'workflow' => 'bb_bug',
        'title' => $identifier,
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    return $ticket;
  }

}
