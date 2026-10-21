<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Reference\ReferenceOptions;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Kernel tests for the project-scoped ticket selection handler.
 *
 * The reader is a non-admin team member of workspace a, so the workspace read
 * scope applies: projects A and B (both in workspace a) are readable, project
 * C (workspace b) is not.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketInTicketProjectSelectionTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  private const HANDLER = 'bb_ticket_in_ticket_project';

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * The service under test.
   */
  private ReferenceOptions $options;

  /**
   * Ticket ids keyed by name: a1 and a2 in A, b1 in B, c1 in C.
   *
   * @var array<string, string>
   */
  private array $tickets = [];

  /**
   * Project ids keyed by name: A, B, C.
   *
   * @var array<string, string>
   */
  private array $projects = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->options = $this->container->get('bb_core.reference_options');

    $project_a = $this->fixture('a', 'bb_project');
    $project_b = $this->createEntity('bb_project', [
      'name' => 'project-a-sibling',
      'group_id' => $project_a->get('group_id')->target_id,
      'teams' => [$this->fixture('a', 'bb_team')->id()],
      'owner_user_id' => $project_a->get('owner_user_id')->target_id,
    ]);
    $this->projects = [
      'A' => (string) $project_a->id(),
      'B' => (string) $project_b->id(),
      'C' => (string) $this->fixture('b', 'bb_project')->id(),
    ];
    $project_a_ticket = $this->fixture('a', 'bb_ticket');
    $this->tickets = [
      'a1' => $this->ticket('Shared word alpha', 'A'),
      'a2' => (string) $project_a_ticket->id(),
      'b1' => $this->ticket('Shared word beta', 'B'),
      'c1' => (string) $this->fixture('b', 'bb_ticket')->id(),
    ];

    $reader = $this->createAccount('reader', [
      'view bb_workspace', 'view bb_project', 'view bb_ticket',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->container->get('current_user')->setAccount($reader);
  }

  /**
   * Only the host project's tickets are offered.
   */
  public function testOffersOnlyHostProjectTickets(): void {
    $offered = $this->options->for($this->host('A'), 'parent_id', handler: self::HANDLER);

    self::assertSame($this->ids('a1', 'a2'), $this->sorted(array_keys($offered)));
  }

  /**
   * A search term never reaches outside the project.
   */
  public function testSearchStaysInProject(): void {
    $offered = $this->options->for($this->host('A'), 'parent_id', 'Shared word', handler: self::HANDLER);

    self::assertSame($this->ids('a1'), $this->sorted(array_keys($offered)));
  }

  /**
   * A host without a project offers nothing.
   */
  public function testHostWithoutProjectOffersNothing(): void {
    self::assertSame([], $this->options->for($this->host(NULL), 'blocked_by', handler: self::HANDLER));
  }

  /**
   * A project the reader cannot read offers nothing.
   */
  public function testOtherWorkspaceTicketNeverOffered(): void {
    self::assertSame([], $this->options->for($this->host('C'), 'parent_id', handler: self::HANDLER));
  }

  /**
   * Cross-project and unreadable ids are reported, valid ones are not.
   */
  public function testUnreferenceableReportsForeignIds(): void {
    $rejected = $this->options->unreferenceable(
      $this->host('A'),
      'blocked_by',
      $this->ids('a1', 'b1', 'c1'),
      self::HANDLER,
    );

    self::assertSame($this->ids('b1', 'c1'), $this->sorted($rejected));
    self::assertSame([], $this->options->unreferenceable($this->host('A'), 'blocked_by', [], self::HANDLER));
  }

  /**
   * A closed ticket is neither offered nor accepted.
   */
  public function testClosedTicketsAreNotOffered(): void {
    $closed = $this->ticket('Shared word closed', 'A');
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->load($closed);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->set('closed', TRUE)->save();

    self::assertSame($this->ids('a1', 'a2'), $this->sorted(array_keys($this->options->for($this->host('A'), 'parent_id', handler: self::HANDLER))));
    self::assertSame([$closed], $this->options->unreferenceable($this->host('A'), 'parent_id', [$closed], self::HANDLER));
  }

  /**
   * A saved ticket is never offered as its own relation.
   */
  public function testSavedHostIsNotOfferedToItself(): void {
    $host = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->load($this->tickets['a1']);
    self::assertInstanceOf(BbTicketInterface::class, $host);

    self::assertSame($this->ids('a2'), $this->sorted(array_keys($this->options->for($host, 'parent_id', handler: self::HANDLER))));
  }

  /**
   * Without an override the field's own handler still spans projects.
   */
  public function testDefaultHandlerUnchanged(): void {
    $offered = array_map('strval', array_keys($this->options->for($this->host('A'), 'parent_id')));

    self::assertContains($this->tickets['b1'], $offered);
    self::assertNotContains($this->tickets['c1'], $offered);
  }

  /**
   * An unsaved ticket in the given project, as the create form holds it.
   */
  private function host(?string $project): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'New ticket',
      'workflow' => 'bb_feature',
      'project_id' => $project !== NULL ? $this->projects[$project] : NULL,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creates a saved ticket in the given project and returns its id.
   */
  private function ticket(string $title, string $project): string {
    return (string) $this->createEntity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_feature',
      'project_id' => $this->projects[$project],
    ])->id();
  }

  /**
   * The sorted ticket ids for the given names.
   *
   * @return list<string>
   *   The ids.
   */
  private function ids(string ...$names): array {
    return $this->sorted(array_map(fn (string $name): string => $this->tickets[$name], $names));
  }

  /**
   * Ids as sorted strings.
   *
   * @param array<int|string> $ids
   *   The ids.
   *
   * @return list<string>
   *   The sorted ids.
   */
  private function sorted(array $ids): array {
    $ids = array_map('strval', $ids);
    sort($ids);
    return $ids;
  }

}
