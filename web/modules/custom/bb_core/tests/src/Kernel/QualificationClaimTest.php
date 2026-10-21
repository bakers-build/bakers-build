<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies that claimNext() surfaces unclassified (workflow-less) tickets.
 *
 * An unclassified ticket has no workflow and no state — it is awaiting
 * qualification by a qualification agent. Any conductor for the matching
 * project must be able to claim it regardless of which states it is registered
 * for.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class QualificationClaimTest extends KernelTestBase {

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
   * The default project all fixtures belong to unless stated otherwise.
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
   * Creates and saves a BbProject, returning its entity ID.
   */
  private function createProject(string $name): int {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $name]);
    $project->save();
    return (int) $project->id();
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
   * Creates and saves a BbConductor registered for a project and states.
   */
  private function createConductor(
    UserInterface $owner,
    string $machine_id,
    array $states = ['todo', 'coding'],
    ?int $project_id = NULL,
  ): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $machine_id,
      'label' => $machine_id,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $project_id ?? $this->projectId,
      'states' => $states,
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates a saved unclassified ticket: no workflow, no state.
   *
   * This ticket has not been qualified yet — no workflow has been assigned. It
   * must be claimable by any conductor for the matching project.
   */
  private function createUnclassifiedTicket(string $identifier, array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create($values + [
        'identifier' => $identifier,
        'title' => $identifier,
        'project_id' => $this->projectId,
        // Intentionally omit 'workflow' and 'state' — unclassified ticket.
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Assigns a ticket to the conductor's owner and saves it.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to assign.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor whose owner becomes the assignee.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket entity.
   */
  private function assignToOwner(BbTicketInterface $ticket, BbConductorInterface $conductor): BbTicketInterface {
    $owner_id = (int) $conductor->get('owner_user_id')->target_id;
    $ticket->set('assignee_user_id', $owner_id)->save();
    return $ticket;
  }

  /**
   * Returns the TicketClaimService from the service container.
   */
  private function claim(): TicketClaimService {
    return $this->container->get('bb_core.ticket_claim');
  }

  /**
   * Verifies claimNext() returns a run for an unclassified ticket.
   *
   * A conductor registered only for classified states (e.g. 'coding') must
   * still be able to claim an unclassified ticket (no workflow, no state)
   * for the same project. The returned run's ticket must be the unclassified
   * ticket.
   */
  public function testClaimNextSurfacesUnclassifiedTicket(): void {
    $owner = $this->createConductorUser('qualification-owner');
    // Conductor handles 'coding' — NOT the empty unclassified state.
    $conductor = $this->createConductor($owner, 'node-qualification', ['coding']);

    $ticket = $this->assignToOwner($this->createUnclassifiedTicket('GL-QUAL-1'), $conductor);

    $run = $this->claim()->claimNext($conductor, 600);

    $this->assertInstanceOf(BbRunInterface::class, $run);
    $this->assertSame('claimed', $run->getRunState());
    $this->assertSame((int) $ticket->id(), $run->getTicketId());
  }

  /**
   * Verifies direct claim() also works for an unclassified ticket.
   *
   * AssertClaimableState must not reject an empty-workflow ticket.
   */
  public function testDirectClaimAllowsUnclassifiedTicket(): void {
    $owner = $this->createConductorUser('qualification-direct-owner');
    $conductor = $this->createConductor($owner, 'node-qualification-direct', ['coding']);

    $ticket = $this->assignToOwner($this->createUnclassifiedTicket('GL-QUAL-2'), $conductor);

    $run = $this->claim()->claim($ticket, $conductor, 600);

    $this->assertSame('claimed', $run->getRunState());
  }

}
