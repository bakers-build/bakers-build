<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\search_api\Entity\Index;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Executes each Project Board column against real Search API data.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectBoardViewTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'display_builder', 'ui_patterns', 'ui_patterns_views',
    'display_builder_views',
    'bb_core', 'bb_board',
  ];

  /**
   * The reader who may view tickets and conductors in workspace A.
   */
  private UserInterface $reader;

  /**
   * Project A.
   */
  private BbProjectInterface $projectA;

  /**
   * Project B, used to prove cross-project isolation.
   */
  private BbProjectInterface $projectB;

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
    $this->installShippedView('views.view.project_board');
    $this->container->get('router.builder')->rebuild();
    $this->buildTwoWorkspaceWorld();

    $project_a = $this->fixture('a', 'bb_project');
    $project_b = $this->fixture('b', 'bb_project');
    self::assertInstanceOf(BbProjectInterface::class, $project_a);
    self::assertInstanceOf(BbProjectInterface::class, $project_b);
    $this->projectA = $project_a;
    $this->projectB = $project_b;

    $this->reader = $this->createAccount('board-reader', [
      'view bb_ticket',
      'view bb_project',
      'view bb_conductor',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $this->reader, []);
  }

  /**
   * Each column holds only this project's tickets in that lifecycle.
   */
  public function testColumnsPlaceOneProjectAndExcludeTheOther(): void {
    $conductor_a = $this->fixture('a', 'bb_conductor');
    $team_a = $this->fixture('a', 'bb_team')->id();
    $fixture = $this->fixture('a', 'bb_ticket');
    self::assertInstanceOf(BbTicketInterface::class, $fixture);
    $backlog = $this->createTicket($this->projectA, 'BOARD-BACK', 'coding', FALSE, NULL);
    $intake = $this->createTicket($this->projectA, 'BOARD-INTAKE', 'qualification', FALSE, $conductor_a->id());
    $working = $this->createTicket($this->projectA, 'BOARD-WORK', 'coding', FALSE, $conductor_a->id());
    $done = $this->createTicket($this->projectA, 'BOARD-DONE', 'cancelled', TRUE, $conductor_a->id());
    $other_conductor = $this->createEntity('bb_conductor', [
      'label' => 'node-a-board',
      'status' => 'online',
      'project_id' => $this->projectA->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $blocked = $this->createTicket($this->projectA, 'BOARD-BLOCK', 'coding', FALSE, $other_conductor->id());
    $blocked->set('blocked_by', [$backlog->id()])->save();

    $sibling = $this->createEntity('bb_project', [
      'name' => 'project-a-board-sibling',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'teams' => [$team_a],
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $sibling);
    $sibling_working = $this->createTicket(
      $sibling,
      'BOARD-SIBLING',
      'coding',
      FALSE,
      $conductor_a->id(),
    );

    $this->createTicket(
      $this->projectB,
      'BOARD-OTHER',
      'coding',
      FALSE,
      $this->fixture('b', 'bb_conductor')->id(),
    );

    $done->markClosed(1_000)->save();
    $oldest_on_page = $this->createTicket($this->projectA, 'BOARD-DONE-NEW', 'cancelled', TRUE, $conductor_a->id());
    $oldest_on_page->markClosed(2_000)->save();
    $newest_on_page = $oldest_on_page;
    for ($i = 1; $i <= 9; $i++) {
      $newest_on_page = $this->createTicket($this->projectA, sprintf('BOARD-DONE-%02d', $i), 'cancelled', TRUE, $conductor_a->id());
      $newest_on_page->markClosed(2_000 + $i)->save();
    }

    $this->indexTickets();

    $backlog_ids = [$backlog->getIdentifier(), $fixture->getIdentifier()];
    sort($backlog_ids);
    $working_ids = [$blocked->getIdentifier(), $working->getIdentifier()];
    sort($working_ids);

    self::assertSame($backlog_ids, $this->identifiers('backlog', $this->projectA));
    self::assertSame([$intake->getIdentifier()], $this->identifiers('intake', $this->projectA));
    self::assertSame($working_ids, $this->identifiers('working', $this->projectA));
    $done_page = $this->identifiersInOrder('done', $this->projectA);
    self::assertCount(10, $done_page);
    self::assertSame($newest_on_page->getIdentifier(), $done_page[0]);
    self::assertSame($oldest_on_page->getIdentifier(), $done_page[9]);
    self::assertNotContains($done->getIdentifier(), $done_page);
    self::assertSame(
      [$sibling_working->getIdentifier()],
      $this->identifiers('working', $sibling),
    );
    self::assertSame([], $this->identifiers('working', $this->projectB));
  }

  /**
   * Classification cases for the derived work_state field.
   *
   * @return array<string, array{bool, string, bool, bool, string}>
   *   closed, state, assigned, frozen, expected work_state.
   */
  public static function workStateCases(): array {
    return [
      'closed beats assigned qualification' => [TRUE, 'qualification', TRUE, FALSE, 'done'],
      'closed beats unassigned coding' => [TRUE, 'coding', FALSE, FALSE, 'done'],
      'unassigned qualification' => [FALSE, 'qualification', FALSE, FALSE, 'not_assigned'],
      'assigned qualification' => [FALSE, 'qualification', TRUE, FALSE, 'intake'],
      'assigned coding' => [FALSE, 'coding', TRUE, FALSE, 'working'],
      'open done assigned' => [FALSE, 'done', TRUE, FALSE, 'working'],
      'open cancelled unassigned' => [FALSE, 'cancelled', FALSE, FALSE, 'not_assigned'],
      'frozen assigned coding stays working' => [FALSE, 'coding', TRUE, TRUE, 'working'],
      'frozen unassigned stays not assigned' => [FALSE, 'coding', FALSE, TRUE, 'not_assigned'],
    ];
  }

  /**
   * Every ticket has exactly one of the four work_state values.
   */
  #[DataProvider('workStateCases')]
  public function testWorkStateClassifiesTicket(
    bool $closed,
    string $state,
    bool $assigned,
    bool $frozen,
    string $expected,
  ): void {
    $conductor_id = $assigned ? $this->fixture('a', 'bb_conductor')->id() : NULL;
    $ticket = $this->createTicket(
      $this->projectA,
      'WS-' . substr(hash('sha256', $state . (int) $closed . (int) $assigned . (int) $frozen), 0, 8),
      'coding',
      FALSE,
      $conductor_id,
    );
    $ticket->set('state', $state);
    $ticket->set('closed', $closed);
    $ticket->setFrozen($frozen);
    self::assertSame($expected, $ticket->get('work_state')->value);
  }

  /**
   * The shared index declares work_state as a string on bb_ticket.
   */
  public function testIndexDeclaresWorkStateStringField(): void {
    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    $field = $index->getField('work_state');
    self::assertNotNull($field);
    self::assertSame('entity:bb_ticket', $field->getDatasourceId());
    self::assertSame('work_state', $field->getPropertyPath());
    self::assertSame('string', $field->getType());
  }

  /**
   * Saving conductor, state or closed updates indexed work_state after a read.
   */
  public function testWorkStateIndexFollowsDependencySavesAfterPriorRead(): void {
    $conductor = $this->fixture('a', 'bb_conductor');
    $ticket = $this->createTicket(
      $this->projectA,
      'WS-TRACK',
      'coding',
      FALSE,
      NULL,
    );
    self::assertSame('not_assigned', $ticket->get('work_state')->value);

    $ticket->set('conductor_id', $conductor->id())->save();
    $this->assertIndexedWorkState($ticket, 'working');

    $ticket->set('state', 'qualification')->save();
    $this->assertIndexedWorkState($ticket, 'intake');

    $ticket->set('closed', TRUE)->save();
    $this->assertIndexedWorkState($ticket, 'done');
  }

  /**
   * Parent focus lists closed descendants in Done; active columns stay open.
   */
  public function testParentScopedDoneIncludesClosedDescendants(): void {
    $conductor = $this->fixture('a', 'bb_conductor');
    $parent = $this->createTicket($this->projectA, 'WS-PAR', 'coding', FALSE, NULL);
    $open = $this->createTicket($this->projectA, 'WS-OPEN', 'coding', FALSE, $conductor->id());
    $open->set('parent_id', $parent->id())->save();
    $closed = $this->createTicket($this->projectA, 'WS-CLSD', 'cancelled', TRUE, $conductor->id());
    $closed->set('parent_id', $parent->id())->save();
    $this->indexTickets();

    $exposed = ['parent_id' => $parent->uuid()];
    self::assertSame([$open->getIdentifier()], $this->identifiers('working', $this->projectA, exposed: $exposed));
    self::assertSame([$closed->getIdentifier()], $this->identifiers('done', $this->projectA, exposed: $exposed));
  }

  /**
   * Creates a ticket on the given project.
   */
  private function createTicket(
    BbProjectInterface $project,
    string $identifier,
    string $state,
    bool $closed,
    mixed $conductor_id,
  ): BbTicketInterface {
    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => $identifier,
      'title' => $identifier,
      'workflow' => 'bb_work',
      'state' => $state,
      'closed' => $closed,
      'project_id' => $project->id(),
      'conductor_id' => $conductor_id,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Indexes every pending ticket.
   */
  private function indexTickets(): void {
    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    $index->indexItems();
  }

  /**
   * Asserts the ticket's indexed work_state without rebuilding the tracker.
   */
  private function assertIndexedWorkState(BbTicketInterface $ticket, string $expected): void {
    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    $index->indexItems();
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    try {
      $query = $index->query();
      $query->addCondition('identifier', $ticket->getIdentifier());
      $results = $query->execute()->getResultItems();
      self::assertCount(1, $results);
      $item = reset($results);
      self::assertSame([$expected], $item->getField('work_state')?->getValues());
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Ticket identifiers from one column display, sorted.
   *
   * @param string $display
   *   The column display id.
   * @param \Drupal\bb_core\Entity\BbProjectInterface $project
   *   The project whose tickets the column lists.
   * @param array<int, string> $conductor
   *   Exposed conductor ids, empty for All.
   * @param array<string, mixed> $exposed
   *   Extra exposed input such as parent_id and work_state.
   *
   * @return list<string>
   *   Sorted identifiers.
   */
  private function identifiers(string $display, BbProjectInterface $project, array $conductor = [], array $exposed = []): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    try {
      $view = Views::getView('project_board');
      self::assertInstanceOf(ViewExecutable::class, $view);
      self::assertTrue($view->setDisplay($display));
      $arguments = [
        (string) $this->fixture('a', 'bb_workspace')->id(),
        (string) $project->id(),
      ];
      $view->setArguments($arguments);
      $input = $exposed;
      if ($conductor !== []) {
        $input['conductor'] = $conductor[0];
      }
      if ($input !== []) {
        $view->setExposedInput($input);
      }
      $view->preExecute($arguments);
      $view->execute($display);
      $ids = [];
      foreach ($view->result as $row) {
        $object = $row->_object ?? NULL;
        $ticket = $object instanceof ComplexDataInterface ? $object->getValue() : NULL;
        if ($ticket instanceof BbTicketInterface) {
          $ids[] = $ticket->getIdentifier();
        }
      }
      sort($ids);
      return $ids;
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Ticket identifiers from one column display, in view order.
   *
   * @return list<string>
   *   Identifiers as the display returned them.
   */
  private function identifiersInOrder(string $display, BbProjectInterface $project): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    try {
      $view = Views::getView('project_board');
      self::assertInstanceOf(ViewExecutable::class, $view);
      self::assertTrue($view->setDisplay($display));
      $arguments = [
        (string) $this->fixture('a', 'bb_workspace')->id(),
        (string) $project->id(),
      ];
      $view->setArguments($arguments);
      $view->preExecute($arguments);
      $view->execute($display);
      $ids = [];
      foreach ($view->result as $row) {
        $object = $row->_object ?? NULL;
        $ticket = $object instanceof ComplexDataInterface ? $object->getValue() : NULL;
        if ($ticket instanceof BbTicketInterface) {
          $ids[] = $ticket->getIdentifier();
        }
      }
      return $ids;
    }
    finally {
      $switcher->switchBack();
    }
  }

}
