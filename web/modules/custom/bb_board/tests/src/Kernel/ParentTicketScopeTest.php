<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\bb_board\ParentTicketScope;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Resolves a board parent to the visible tickets below it, at every depth.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ParentTicketScopeTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'bb_core', 'bb_board', 'bb_property_access_test',
  ];

  /**
   * A member of workspace A.
   */
  private UserInterface $reader;

  /**
   * Project A.
   */
  private BbProjectInterface $project;

  /**
   * Tickets by fixture name.
   *
   * @var array<string, \Drupal\bb_core\Entity\BbTicketInterface>
   */
  private array $tickets = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->buildTwoWorkspaceWorld();

    $project = $this->fixture('a', 'bb_project');
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;

    $this->reader = $this->createAccount('scope-reader', ['view bb_ticket', 'view bb_project']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $this->reader, []);
    $this->container->get('current_user')->setAccount($this->reader);

    // P is the parent; B is closed and still leads to C; F is done; X sits in
    // another project with a corrupt edge to P, and Y below X must not be
    // reached through it.
    $this->ticket('P', NULL, 'review');
    $this->ticket('A', 'P', 'coding');
    $this->ticket('B', 'P', 'review', TRUE);
    $this->ticket('C', 'B', 'review');
    $this->ticket('D', 'P', 'qualification');
    $this->ticket('E', 'A', 'coding');
    $this->ticket('F', 'P', 'done', TRUE);
    $this->ticket('U', NULL, 'coding');
    $this->ticket('X', 'P', 'coding', FALSE, $this->fixture('b', 'bb_project')->id());
    $this->ticket('Y', 'X', 'coding');
    $this->ticket('LEAF', NULL, 'coding');
  }

  /**
   * Every visible descendant counts once, closed paths are walked, root never.
   */
  public function testSubtreeWalksClosedNodesAndExcludesRootAndForeignBranches(): void {
    $result = $this->scope()->resolve($this->project, $this->tickets['P']->uuid());

    self::assertSame('parent', $result['mode']);
    self::assertSame((string) $this->tickets['P']->id(), (string) $result['parent']?->id());
    self::assertNull($result['message']);
    self::assertSame(['A', 'B', 'C', 'D', 'E', 'F'], $this->names($result['ticket_ids']));
  }

  /**
   * A cycle back to the root ends the walk without counting anything twice.
   */
  public function testCycleThroughTheRootTerminates(): void {
    $this->tickets['P']->set('parent_id', $this->tickets['C']->id())->save();

    $result = $this->scope()->resolve($this->project, $this->tickets['P']->uuid());

    self::assertSame(['A', 'B', 'C', 'D', 'E', 'F'], $this->names($result['ticket_ids']));
  }

  /**
   * A leaf is a valid parent with nothing below it.
   */
  public function testLeafIsValidEmptyScope(): void {
    $result = $this->scope()->resolve($this->project, $this->tickets['LEAF']->uuid());

    self::assertSame('parent', $result['mode']);
    self::assertSame([], $result['ticket_ids']);
  }

  /**
   * No selection is the normal project board, not an empty scope.
   */
  public function testMissingSelectionKeepsTheProjectBoard(): void {
    foreach ([NULL, ''] as $raw) {
      $result = $this->scope()->resolve($this->project, $raw);
      self::assertSame('project', $result['mode']);
      self::assertNull($result['parent']);
      self::assertSame([], $result['ticket_ids']);
    }
  }

  /**
   * Malformed, unknown, foreign and nested input are one generic refusal.
   */
  public function testInvalidSelectionsRevealNothing(): void {
    $foreign = $this->fixture('b', 'bb_ticket');
    $cases = [
      'malformed' => 'not-a-uuid',
      'unknown' => '6f0d3c1e-0000-4000-8000-000000000000',
      'foreign project' => $foreign->uuid(),
      'nested' => [$this->tickets['P']->uuid()],
      'integer' => 5,
    ];
    foreach ($cases as $case => $raw) {
      $result = $this->scope()->resolve($this->project, $raw);
      self::assertSame('invalid', $result['mode'], $case);
      self::assertNull($result['parent'], $case);
      self::assertSame([], $result['ticket_ids'], $case);
      self::assertSame('Parent ticket is unavailable.', (string) $result['message'], $case);
    }
  }

  /**
   * A parent the reader cannot see is refused like an unknown one.
   */
  public function testInaccessibleParentIsRefused(): void {
    $outsider = $this->createAccount('scope-outsider', ['view bb_ticket', 'view bb_project']);
    $this->container->get('current_user')->setAccount($outsider);

    $result = $this->scope()->resolve($this->project, $this->tickets['P']->uuid());

    self::assertSame('invalid', $result['mode']);
    self::assertSame([], $result['ticket_ids']);
  }

  /**
   * A denied relationship field is never used to connect tickets.
   */
  public function testDeniedScopeFieldIsNotTraversed(): void {
    $this->container->get('state')->set('bb_property_access_test.denied', [
      'view' => ['parent_id'],
    ]);
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket')->resetCache();

    $result = $this->scope()->resolve($this->project, $this->tickets['P']->uuid());

    self::assertSame('invalid', $result['mode']);
    self::assertSame([], $result['ticket_ids']);
  }

  /**
   * Options are open non-terminal parents that have a visible child.
   */
  public function testOptionsListOnlyOpenParentsWithVisibleChildren(): void {
    $this->ticket('CANCP', NULL, 'cancelled', TRUE);
    $this->ticket('CANCC', 'CANCP', 'coding');
    $this->ticket('HIDP', NULL, 'coding');
    $this->ticket('HIDCH', 'HIDP', 'coding', FALSE, $this->fixture('b', 'bb_project')->id());

    $options = $this->scope()->options($this->project);

    $labels = array_values($options);
    $sorted = $labels;
    sort($sorted);
    self::assertSame($sorted, $labels, 'Options are ordered by identifier.');
    self::assertSame($this->tickets['A']->getIdentifier() . ' scope A', $options[$this->tickets['A']->uuid()]);
    self::assertSame($this->tickets['P']->getIdentifier() . ' scope P', $options[$this->tickets['P']->uuid()]);
    self::assertCount(2, $options);
    self::assertArrayNotHasKey($this->tickets['B']->uuid(), $options, 'A closed parent is omitted.');
    self::assertArrayNotHasKey($this->tickets['CANCP']->uuid(), $options, 'A terminal parent is omitted.');
    self::assertArrayNotHasKey($this->tickets['LEAF']->uuid(), $options);
    self::assertArrayNotHasKey($this->tickets['U']->uuid(), $options);
    self::assertArrayNotHasKey($this->tickets['HIDP']->uuid(), $options, 'A foreign child does not qualify its parent.');
    self::assertArrayNotHasKey($this->tickets['X']->uuid(), $options);
    self::assertArrayNotHasKey($this->fixture('b', 'bb_ticket')->uuid(), $options);
  }

  /**
   * A child the reader cannot inspect does not reveal its parent.
   */
  public function testHiddenChildrenDoNotQualifyTheirParent(): void {
    $this->container->get('state')->set('bb_property_access_test.denied', [
      'view' => ['parent_id'],
    ]);
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket')->resetCache();

    self::assertSame([], $this->scope()->options($this->project));
  }

  /**
   * Options are built once per request, not once per display.
   */
  public function testOptionsAreReusedWithinRequest(): void {
    $first = $this->scope()->options($this->project);
    $this->ticket('LATE', NULL, 'coding');
    self::assertSame($first, $this->scope()->options($this->project));
  }

  /**
   * The resolver.
   */
  private function scope(): ParentTicketScope {
    $scope = $this->container->get(ParentTicketScope::class);
    self::assertInstanceOf(ParentTicketScope::class, $scope);
    return $scope;
  }

  /**
   * Creates one named ticket in project A unless another project is given.
   */
  private function ticket(string $name, ?string $parent, string $state, bool $closed = FALSE, mixed $project_id = NULL): void {
    $project_id ??= $this->project->id();
    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => 'SCOPE-' . $name,
      'title' => 'scope ' . $name,
      'workflow' => 'bb_feature',
      'state' => $state,
      'closed' => $closed,
      'project_id' => $project_id,
      'parent_id' => $parent === NULL ? NULL : $this->tickets[$parent]->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->tickets[$name] = $ticket;
  }

  /**
   * Fixture names for ticket ids, sorted.
   *
   * @param list<string> $ids
   *   Ticket entity ids.
   *
   * @return list<string>
   *   The fixture names.
   */
  private function names(array $ids): array {
    $by_id = [];
    foreach ($this->tickets as $name => $ticket) {
      $by_id[(string) $ticket->id()] = $name;
    }
    $names = array_map(static fn (string $id): string => $by_id[$id] ?? $id, $ids);
    sort($names);
    return $names;
  }

}
