<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * BB-664 review F6: `parent_id` needs the same cycle guard `blocked_by` has.
 */
#[Group('bb_core')]
final class ParentAcyclicConstraintTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * The project every ticket in this suite is created in.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_workspace',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_term', 'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    $this->createUser([], 'uid1-dummy');

    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'Acyclic-parent project']);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
  }

  /**
   * A ticket self-parented directly violates the constraint.
   */
  public function testSelfParentViolates(): void {
    $ticket = $this->createTicket('Self parent');
    $ticket->set('parent_id', $ticket->id());

    self::assertGreaterThan(0, $ticket->validate()->count());
  }

  /**
   * A two-step cycle (A -> B -> A) violates the constraint on the closing save.
   */
  public function testTwoStepCycleViolates(): void {
    $a = $this->createTicket('A');
    $b = $this->createTicket('B');
    $b->set('parent_id', $a->id());
    $b->save();

    $a->set('parent_id', $b->id());

    self::assertGreaterThan(0, $a->validate()->count());
  }

  /**
   * An ordinary, acyclic parent assignment is unaffected.
   */
  public function testOrdinaryParentIsUnaffected(): void {
    $a = $this->createTicket('Parent');
    $b = $this->createTicket('Child');
    $b->set('parent_id', $a->id());

    $messages = array_map(
      static fn ($v): string => (string) $v->getMessage(),
      iterator_to_array($b->validate()),
    );
    foreach ($messages as $message) {
      self::assertStringNotContainsString('cycle', $message, 'An ordinary, acyclic parent must not trip the cycle guard.');
    }
  }

  /**
   * Creates and saves a minimal ticket in the fixture project.
   */
  private function createTicket(string $title): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create(['title' => $title, 'workflow' => 'bb_work', 'project_id' => $this->project->id()]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

}
