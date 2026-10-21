<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies entity-level validation guards on BbTicket.
 *
 * Covers blocked_by cycle detection, self-reference prevention, valid linear
 * chains, and assignee_user_id acceptance.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketGuardsTest extends KernelTestBase {

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // bb_run is required because BbTicket's computed `runs` reverse-ref
    // field (RunsItemList) queries it during entity validation.
    $schemas = [
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run',
    ];
    foreach ($schemas as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Validating an entity reference runs an access-checked query through the
    // selection handler, so since BB-305 the acting account needs view
    // access to the target type or the reference reads as "cannot be
    // referenced". These tests are about the blocked_by guards, not about
    // read access.
    $this->setUpCurrentUser([], [
      'view bb_ticket', 'view bb_project', 'view bb_conductor',
      // Plus `administer bakers` since BB-318: the workspace read scope
      // narrows every access-checked collection query to the acting
      // account's OG memberships, and reference validation runs one. The
      // type's admin permission is the documented bypass (D7 guard 2) — the
      // right fix for a test whose subject is not read access, and the
      // alternative to inventing a workspace chain it does not otherwise
      // need. The read scope itself is covered by WorkspaceReadScope*Test.
      'administer bakers',
      // And `administer users` for the same reason on a DIFFERENT type:
      // assignee_user_id references `user`, which BB-318 narrows to the
      // account's workspace peers, and `administer bakers` does not bypass it —
      // each type's own admin permission does (spec R3).
      'administer users',
    ]);
  }

  /**
   * Creates and saves a BbTicket entity with the given identifier.
   *
   * @param string $identifier
   *   Human-readable ticket identifier.
   * @param array $values
   *   Optional additional field values to merge in.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket entity.
   */
  private function createTicket(string $identifier, array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create($values + ['identifier' => $identifier, 'workflow' => 'bb_bug', 'title' => $identifier]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Verifies that a blocked_by cycle (A blocks B, B blocks A) is rejected.
   *
   * Expects a validation violation on the blocked_by field.
   */
  public function testBlockedByCycleRejected(): void {
    $a = $this->createTicket('GL-A');
    $b = $this->createTicket('GL-B', ['blocked_by' => [$a->id()]]);
    $a->set('blocked_by', [$b->id()]);
    $violations = $a->validate();
    $this->assertGreaterThan(0, count($violations->getByField('blocked_by')));
  }

  /**
   * Verifies that a ticket cannot list itself as its own blocker.
   */
  public function testBlockedBySelfReferenceRejected(): void {
    $a = $this->createTicket('GL-C');
    $a->set('blocked_by', [$a->id()]);
    $violations = $a->validate();
    $this->assertGreaterThan(0, count($violations->getByField('blocked_by')));
  }

  /**
   * Verifies that a linear blocked_by chain passes validation without errors.
   */
  public function testBlockedByChainAllowed(): void {
    $a = $this->createTicket('GL-D');
    $b = $this->createTicket('GL-E', ['blocked_by' => [$a->id()]]);
    $c = $this->createTicket('GL-F');
    $c->set('blocked_by', [$b->id()]);
    $violations = $c->validate();
    $this->assertCount(0, $violations->getByField('blocked_by'));
  }

  /**
   * Verifies that assignee_user_id set to an existing user passes validation.
   */
  public function testAssigneeUserAllowed(): void {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'human-assignee', 'status' => 1]);
    $user->save();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => 'GL-H',
        'workflow' => 'bb_bug',
        'title' => 'X',
        'assignee_user_id' => $user->id(),
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $violations = $ticket->validate();
    $this->assertCount(0, $violations->getByField('assignee_user_id'));
  }

}
