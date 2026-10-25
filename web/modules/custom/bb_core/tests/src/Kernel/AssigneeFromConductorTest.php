<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies bb_ticket derives its assignee from the conductor's owner.
 *
 * A ticket that names a conductor but no assignee gets the conductor's
 * owner_user_id at save; a ticket that already names an assignee is never
 * overwritten. The rule is checked on every save (create and update alike),
 * so it is idempotent and self-healing rather than change-triggered.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class AssigneeFromConductorTest extends KernelTestBase {

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
   * The project both the tickets and the conductors belong to.
   */
  private int $projectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // BbTicket::preSave() reaches into runs, so bb_run must exist too.
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // UID 1 dummy so entity ownership checks never land on UID 0.
    $this->createAccount('uid1-dummy');
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'derive-project']);
    $project->save();
    $this->projectId = (int) $project->id();
  }

  /**
   * Creates and saves a plain user account.
   */
  private function createAccount(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')
      ->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a conductor, optionally without an owner.
   */
  private function createConductor(string $machine_id, ?UserInterface $owner): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => $machine_id,
        'label' => $machine_id,
        // 0 is anonymous, i.e. "no owner": BB-305 made owner_user_id the
        // entity's owner key and core stores an entity-key column NOT NULL.
        'owner_user_id' => $owner?->id() ?? 0,
        'status' => 'online',
        'project_id' => $this->projectId,
        'states' => ['working'],
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates an unsaved ticket in this test's project.
   *
   * @param array<string, mixed> $values
   *   Extra field values merged over the defaults.
   */
  private function createTicket(array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create($values + [
        'title' => 'Derivation ticket',
        'workflow' => 'bb_work',
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creating with a conductor and no assignee derives the owner (AC-1).
   */
  public function testCreateWithConductorDerivesOwner(): void {
    $owner = $this->createAccount('owner-create');
    $conductor = $this->createConductor('node-create', $owner);

    $ticket = $this->createTicket(['conductor_id' => $conductor->id()]);
    $ticket->save();

    $this->assertSame(
      (string) $owner->id(),
      (string) $ticket->get('assignee_user_id')->target_id,
    );
  }

  /**
   * Assigning a conductor on a later update derives the owner (AC-2).
   */
  public function testLaterConductorAssignmentDerivesOwner(): void {
    $owner = $this->createAccount('owner-update');
    $conductor = $this->createConductor('node-update', $owner);

    $ticket = $this->createTicket();
    $ticket->save();
    $this->assertTrue($ticket->get('assignee_user_id')->isEmpty());

    $ticket->set('conductor_id', $conductor->id());
    $ticket->save();

    $this->assertSame(
      (string) $owner->id(),
      (string) $ticket->get('assignee_user_id')->target_id,
    );
  }

  /**
   * A set assignee survives a conductor switch to another owner (AC-3).
   */
  public function testSetAssigneeIsNeverOverwritten(): void {
    $human = $this->createAccount('human-owner');
    $first_owner = $this->createAccount('owner-first');
    $second_owner = $this->createAccount('owner-second');
    $first = $this->createConductor('node-first', $first_owner);
    $second = $this->createConductor('node-second', $second_owner);

    $ticket = $this->createTicket([
      'assignee_user_id' => $human->id(),
      'conductor_id' => $first->id(),
    ]);
    $ticket->save();
    $ticket->set('conductor_id', $second->id());
    $ticket->save();

    $this->assertSame(
      (string) $human->id(),
      (string) $ticket->get('assignee_user_id')->target_id,
    );
  }

  /**
   * A ticket without a conductor gets no assignee (AC-4).
   */
  public function testNoConductorDerivesNothing(): void {
    $ticket = $this->createTicket();
    $ticket->save();

    $this->assertTrue($ticket->get('assignee_user_id')->isEmpty());
  }

  /**
   * An owner-less conductor derives nothing and the save succeeds (AC-5).
   */
  public function testOwnerlessConductorDerivesNothingWithoutError(): void {
    $conductor = $this->createConductor('node-ownerless', NULL);

    $ticket = $this->createTicket(['conductor_id' => $conductor->id()]);
    $ticket->save();

    $this->assertNotNull($ticket->id());
    $this->assertTrue($ticket->get('assignee_user_id')->isEmpty());
  }

  /**
   * A second save of an already-derived ticket changes nothing (AC-6).
   */
  public function testDerivationIsIdempotent(): void {
    $owner = $this->createAccount('owner-idempotent');
    $other = $this->createAccount('owner-other');
    $conductor = $this->createConductor('node-idempotent', $owner);

    $ticket = $this->createTicket(['conductor_id' => $conductor->id()]);
    $ticket->save();
    // Re-point the conductor's owner: a change-blind re-derivation would
    // follow it, the never-overwrite rule must not.
    $conductor->set('owner_user_id', $other->id())->save();
    $ticket->save();

    $this->assertSame(
      (string) $owner->id(),
      (string) $ticket->get('assignee_user_id')->target_id,
    );
  }

  /**
   * A derived assignee does not affect claim eligibility (AC-8).
   */
  public function testDerivedAssigneeDoesNotAffectClaiming(): void {
    $owner = $this->createAccount('owner-claim');
    $conductor = $this->createConductor('node-claim', $owner);

    $ticket = $this->createTicket([
      'conductor_id' => $conductor->id(),
      'state' => 'working',
    ]);
    $ticket->save();
    $this->assertFalse($ticket->get('assignee_user_id')->isEmpty());

    // claimNext() takes no account — access is enforced at the API layer, not
    // in the service — so this is the whole claim decision, unmediated.
    $run = $this->container->get('bb_core.ticket_claim')->claimNext($conductor);

    $this->assertInstanceOf(BbRunInterface::class, $run);
    $this->assertSame((string) $ticket->id(), (string) $run->getTicket()?->id());
  }

}
