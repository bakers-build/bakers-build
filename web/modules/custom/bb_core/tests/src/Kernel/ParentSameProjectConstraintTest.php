<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * A newly set parent must be in the ticket's project, on every write path.
 *
 * @group bb_core
 */
#[Group('bb_core')]
final class ParentSameProjectConstraintTest extends KernelTestBase {

  use UserCreationTrait;

  private const MESSAGE = "The parent ticket must be in this ticket's project.";

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * Project ids keyed by name: A, B.
   *
   * @var array<string, string>
   */
  private array $projects = [];

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
    // Read access is not the subject here; the bypass keeps core's
    // ValidReference out of the way.
    $this->setUpCurrentUser([], ['view bb_ticket', 'administer bakers']);
    foreach (['A', 'B'] as $name) {
      $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
        ->create(['name' => "Project $name"]);
      $project->save();
      $this->projects[$name] = (string) $project->id();
    }
  }

  /**
   * A new ticket with a parent in another project violates.
   */
  public function testNewTicketWithForeignParentViolates(): void {
    $parent = $this->ticket('Parent', 'B');
    $child = $this->ticket('Child', 'A', $parent, FALSE);

    self::assertSame([self::MESSAGE], $this->parentMessages($child));
  }

  /**
   * A parent in the same project is fine.
   */
  public function testSameProjectParentPasses(): void {
    $parent = $this->ticket('Parent', 'A');

    self::assertSame([], $this->parentMessages($this->ticket('Child', 'A', $parent, FALSE)));
  }

  /**
   * Changing a saved ticket's parent to another project violates.
   */
  public function testChangedParentIsChecked(): void {
    $child = $this->ticket('Child', 'A');
    $child->set('parent_id', $this->ticket('Parent', 'B')->id());

    self::assertSame([self::MESSAGE], $this->parentMessages($child));
  }

  /**
   * A stored foreign parent survives an unrelated change.
   */
  public function testStoredForeignParentIsKept(): void {
    $child = $this->ticket('Child', 'A', $this->ticket('Parent', 'B'));
    $child->set('title', 'Renamed');

    self::assertSame([], $this->parentMessages($child));
  }

  /**
   * Moving a ticket to another project keeps its unchanged parent valid.
   */
  public function testProjectMoveWithUnchangedParentPasses(): void {
    $child = $this->ticket('Child', 'A', $this->ticket('Parent', 'A'));
    $child->set('project_id', $this->projects['B']);

    self::assertSame([], $this->parentMessages($child));
  }

  /**
   * A ticket without a project is left to project_id's own validation.
   */
  public function testTicketWithoutProjectIsNotCompared(): void {
    $child = $this->ticket('Child', 'A', $this->ticket('Parent', 'B'), FALSE);
    $child->set('project_id', NULL);

    self::assertSame([], $this->parentMessages($child));
  }

  /**
   * Blocked by may still reference another project.
   */
  public function testForeignBlockerPasses(): void {
    $child = $this->ticket('Child', 'A');
    $child->set('blocked_by', [$this->ticket('Blocker', 'B')->id()]);

    self::assertCount(0, $child->validate());
  }

  /**
   * The parent_id violation messages of a ticket.
   *
   * @return list<string>
   *   The messages.
   */
  private function parentMessages(BbTicketInterface $ticket): array {
    $messages = [];
    foreach ($ticket->validate()->getByField('parent_id') as $violation) {
      $messages[] = (string) $violation->getMessage();
    }
    return $messages;
  }

  /**
   * Creates a ticket in the given project, saved unless told otherwise.
   */
  private function ticket(string $title, string $project, ?BbTicketInterface $parent = NULL, bool $save = TRUE): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => $title,
      'workflow' => 'bb_work',
      'project_id' => $this->projects[$project],
      'parent_id' => $parent?->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    if ($save) {
      $ticket->save();
    }
    return $ticket;
  }

}
