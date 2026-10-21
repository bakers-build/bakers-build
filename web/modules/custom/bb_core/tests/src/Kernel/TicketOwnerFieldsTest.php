<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The computed owner display fields.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketOwnerFieldsTest extends KernelTestBase {

  use UserCreationTrait;

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
   * The project the tickets belong to.
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
    $this->createUser([], 'uid1-dummy');
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'owner-fields-project']);
    $project->save();
    $this->projectId = (int) $project->id();
  }

  /**
   * Creates and saves a ticket in this test's project.
   *
   * @param array<string, mixed> $values
   *   Extra field values merged over the defaults.
   */
  private function createTicket(array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create($values + [
        'title' => 'Owner fields ticket',
        'workflow' => 'bb_feature',
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The owner fields derive their value from owner_user_id.
   */
  public function testOwnerFieldsDeriveFromTheOwnerReference(): void {
    $user = $this->createUser([], 'Ada Lovelace');
    self::assertInstanceOf(UserInterface::class, $user);
    $ticket = $this->createTicket(['owner_user_id' => $user->id()]);

    self::assertSame('Ada Lovelace', $ticket->get('owner_name')->value);
    self::assertSame('AL', $ticket->get('owner_initials')->value);
  }

  /**
   * The owner fields are empty when the ticket has no owner.
   */
  public function testOwnerFieldsAreEmptyWithoutAnOwner(): void {
    // 0 is anonymous, i.e. "no owner": owner_user_id is the entity's own
    // owner key and core stores an entity-key column NOT NULL.
    $ticket = $this->createTicket(['owner_user_id' => 0]);

    self::assertSame('', $ticket->get('owner_name')->value);
    self::assertSame('', $ticket->get('owner_initials')->value);
  }

  /**
   * The owner and the assignee derive independently from different users.
   */
  public function testOwnerAndAssigneeAreIndependent(): void {
    $owner = $this->createUser([], 'Ada Lovelace');
    $assignee = $this->createUser([], 'Grace Hopper');
    self::assertInstanceOf(UserInterface::class, $owner);
    self::assertInstanceOf(UserInterface::class, $assignee);
    $ticket = $this->createTicket([
      'owner_user_id' => $owner->id(),
      'assignee_user_id' => $assignee->id(),
    ]);

    self::assertSame('Ada Lovelace', $ticket->get('owner_name')->value);
    self::assertSame('Grace Hopper', $ticket->get('assignee_name')->value);
  }

  /**
   * The owner and the assignee may both point at the same user.
   */
  public function testOwnerAndAssigneeMayBeTheSameUser(): void {
    $user = $this->createUser([], 'Ada Lovelace');
    self::assertInstanceOf(UserInterface::class, $user);
    $ticket = $this->createTicket([
      'owner_user_id' => $user->id(),
      'assignee_user_id' => $user->id(),
    ]);

    self::assertSame('Ada Lovelace', $ticket->get('owner_name')->value);
    self::assertSame('Ada Lovelace', $ticket->get('assignee_name')->value);
  }

}
