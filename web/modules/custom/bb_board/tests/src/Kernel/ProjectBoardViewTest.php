<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbRunInterface;
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
    $this->installSchema('user', ['users_data']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.project_board');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
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
      'conductor_id' => 'node-a-board',
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

    // Inside the seven-day window, so the order decides the first page.
    $day_ago = $this->container->get('datetime.time')->getRequestTime() - 86_400;
    $done->markClosed($day_ago + 1_000)->save();
    $oldest_on_page = $this->createTicket($this->projectA, 'BOARD-DONE-NEW', 'cancelled', TRUE, $conductor_a->id());
    $oldest_on_page->markClosed($day_ago + 2_000)->save();
    $newest_on_page = $oldest_on_page;
    for ($i = 1; $i <= 9; $i++) {
      $newest_on_page = $this->createTicket($this->projectA, sprintf('BOARD-DONE-%02d', $i), 'cancelled', TRUE, $conductor_a->id());
      $newest_on_page->markClosed($day_ago + 2_000 + $i)->save();
    }

    $this->indexTickets();

    $backlog_ids = [$backlog->getIdentifier(), $fixture->getIdentifier()];
    sort($backlog_ids);
    $intake_ids = [$blocked->getIdentifier(), $intake->getIdentifier()];
    sort($intake_ids);

    self::assertSame($backlog_ids, $this->identifiers('backlog', $this->projectA));
    self::assertSame($intake_ids, $this->identifiers('intake', $this->projectA));
    self::assertSame([$working->getIdentifier()], $this->identifiers('working', $this->projectA));
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
   * @return array<string, array{bool, string, bool, bool, string, 2?: string|null, 3?: string|null}>
   *   closed, state, assigned, frozen, expected work_state, then the state of
   *   the ticket's single blocker and of its single run, each NULL for none.
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
      'blocked, conductor, no live run' => [FALSE, 'coding', TRUE, FALSE, 'intake', 'coding'],
      'blocked, conductor, live run' => [FALSE, 'coding', TRUE, FALSE, 'working', 'coding', 'running'],
      'blocked, conductor, finished run' => [FALSE, 'coding', TRUE, FALSE, 'intake', 'coding', 'done'],
      'blocked, no conductor' => [FALSE, 'coding', FALSE, FALSE, 'not_assigned', 'coding'],
      'blocker done' => [FALSE, 'coding', TRUE, FALSE, 'working', 'done'],
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
    ?string $blockerState = NULL,
    ?string $runState = NULL,
  ): void {
    $conductor_id = $assigned ? $this->fixture('a', 'bb_conductor')->id() : NULL;
    $ticket = $this->createTicket(
      $this->projectA,
      'WS-' . substr(hash('sha256', $state . (int) $closed . (int) $assigned . (int) $frozen . $blockerState . $runState), 0, 8),
      'coding',
      FALSE,
      $conductor_id,
    );
    $ticket->set('state', $state);
    $ticket->set('closed', $closed);
    $ticket->setFrozen($frozen);
    if ($blockerState !== NULL) {
      $blocker = $this->createTicket($this->projectA, 'WS-BLK-' . $blockerState, $blockerState, FALSE, $conductor_id);
      $ticket->set('blocked_by', [$blocker->id()]);
    }
    if ($runState !== NULL) {
      $this->createRun($ticket, $runState);
    }
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
   * Closing a blocker re-indexes the tickets it blocks.
   */
  public function testWorkStateIndexFollowsBlockerClosure(): void {
    $conductor = $this->fixture('a', 'bb_conductor');
    $blocker = $this->createTicket($this->projectA, 'WS-BLKR', 'working', FALSE, $conductor->id());
    $ticket = $this->createTicket($this->projectA, 'WS-BLKD', 'working', FALSE, $conductor->id());
    $ticket->set('blocked_by', [$blocker->id()])->save();
    $this->assertIndexedWorkState($ticket, 'intake');

    $blocker->set('state', 'done')->save();
    $this->assertIndexedWorkState($ticket, 'working');
  }

  /**
   * Saving a run re-indexes its ticket.
   */
  public function testWorkStateIndexFollowsRunSave(): void {
    $conductor = $this->fixture('a', 'bb_conductor');
    $blocker = $this->createTicket($this->projectA, 'WS-RBLR', 'coding', FALSE, $conductor->id());
    $ticket = $this->createTicket($this->projectA, 'WS-RUNT', 'coding', FALSE, $conductor->id());
    $ticket->set('blocked_by', [$blocker->id()])->save();
    $run = $this->createRun($ticket, 'running');
    $this->assertIndexedWorkState($ticket, 'working');

    $run->set('state', 'done')->save();
    $this->assertIndexedWorkState($ticket, 'intake');
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
   * States splits Working into one sub-column per state that has tickets.
   */
  public function testDetailsSplitsWorkingByState(): void {
    $conductor = $this->fixture('a', 'bb_conductor')->id();
    $this->createTicket($this->projectA, 'DET-PLAN', 'plan', FALSE, $conductor);
    $this->createTicket($this->projectA, 'DET-REVIEW-1', 'review', FALSE, $conductor);
    $this->createTicket($this->projectA, 'DET-REVIEW-2', 'review', FALSE, $conductor);
    $this->indexTickets();

    $html = $this->board(['details' => 'states']);
    $columns = $this->columns($html);
    self::assertSame(3, $columns['Working'] ?? NULL, 'The Working panel counts the sum.');
    self::assertSame(1, $columns['plan'] ?? NULL);
    self::assertSame(2, $columns['review'] ?? NULL);
    self::assertArrayNotHasKey('working', $columns, 'A state without tickets gets no sub-column.');
    self::assertStringContainsString('empty: working', $this->text($html));
    self::assertStringNotContainsString('empty: plan', $this->text($html));
    self::assertStringNotContainsString('empty: review', $this->text($html));

    $phases = $this->columns($this->board(['details' => 'phases']));
    self::assertSame(3, $phases['Working'] ?? NULL);
    self::assertArrayNotHasKey('plan', $phases, 'Phases shows no sub-columns.');
  }

  /**
   * The state sub-columns carry the same exposed filters as Working.
   */
  public function testSubColumnsCarryTheBoardFilters(): void {
    $working = $this->exposedIdentifiers('working');
    self::assertContains('search', $working);
    foreach (['working_plan', 'working_working', 'working_review'] as $display) {
      self::assertSame($working, $this->exposedIdentifiers($display), $display);
    }
  }

  /**
   * With Phases, an empty column keeps its header, count 0 and a sentence.
   */
  public function testPhasesKeepsEmptyColumns(): void {
    // The world's one open ticket of project A has no conductor.
    $this->indexTickets();
    $html = $this->board([]);
    $columns = $this->columns($html);
    self::assertSame(1, $columns['Not assigned'] ?? NULL);
    self::assertSame(0, $columns['Intake'] ?? NULL);
    self::assertSame(0, $columns['Working'] ?? NULL);
    // Intake and Working; the closed Done column shows no body.
    self::assertSame(2, substr_count($this->text($html), 'No ticket matches these filters.'));
  }

  /**
   * Done shows the tickets closed in the last seven days.
   */
  public function testDoneShowsLastSevenDays(): void {
    [$recent] = $this->closedTwoAndNineDaysAgo();
    $this->request(['done' => 'show']);
    self::assertSame([$recent->getIdentifier()], $this->identifiersInOrder('done', $this->projectA));
    self::assertSame(1, $this->columns($this->board(['done' => 'show']))['Done'] ?? NULL);
  }

  /**
   * Show older drops the window, newest first.
   */
  public function testShowOlderAddsOlderTickets(): void {
    [$recent, $old] = $this->closedTwoAndNineDaysAgo();
    $this->request(['done' => 'show', 'done_older' => '1']);
    self::assertSame(
      [$recent->getIdentifier(), $old->getIdentifier()],
      $this->identifiersInOrder('done', $this->projectA),
    );
    self::assertSame(2, $this->columns($this->board(['done' => 'show', 'done_older' => '1']))['Done'] ?? NULL);
  }

  /**
   * A closed Done column shows the window's count and no cards.
   */
  public function testClosedDoneKeepsCountWithoutCards(): void {
    [$recent] = $this->closedTwoAndNineDaysAgo();

    $closed = $this->board(['done' => 'hide']);
    self::assertSame(1, $this->columns($closed)['Done'] ?? NULL);
    self::assertStringNotContainsString($recent->getIdentifier(), $closed);
    self::assertStringContainsString('Show done', $this->text($closed));
    self::assertStringContainsString('done=show', $closed);
    self::assertStringNotContainsString('last 7 days', $this->text($closed));

    $open = $this->board(['done' => 'show']);
    self::assertStringContainsString($recent->getIdentifier(), $open);
    self::assertStringContainsString('last 7 days', $this->text($open));
    self::assertStringContainsString('Show older', $this->text($open));
    self::assertStringContainsString('done_older=1', $open);

    $older = $this->text($this->board(['done' => 'show', 'done_older' => '1']));
    self::assertStringNotContainsString('last 7 days', $older);
    self::assertStringNotContainsString('Show older', $older);
  }

  /**
   * Two closed tickets of project A: two and nine days ago.
   *
   * @return array{BbTicketInterface, BbTicketInterface}
   *   The recent ticket, then the old one.
   */
  private function closedTwoAndNineDaysAgo(): array {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $conductor = $this->fixture('a', 'bb_conductor')->id();
    $recent = $this->createTicket($this->projectA, 'DONE-RECENT', 'done', TRUE, $conductor);
    $recent->markClosed($now - 2 * 86_400)->save();
    $old = $this->createTicket($this->projectA, 'DONE-OLD', 'done', TRUE, $conductor);
    $old->markClosed($now - 9 * 86_400)->save();
    $this->indexTickets();
    return [$recent, $old];
  }

  /**
   * Makes the current request carry this query, as the browser would.
   *
   * @param array<string, mixed> $query
   *   The query parameters.
   */
  private function request(array $query): void {
    $this->container->get('request_stack')->getCurrentRequest()->query->replace($query);
  }

  /**
   * The rendered columns of project A's board in the theme, as the reader.
   *
   * @param array<string, mixed> $query
   *   The request's query parameters.
   */
  private function board(array $query): string {
    $this->request($query);
    $this->container->get('theme.manager')->setActiveTheme(
      $this->container->get('theme.initialization')->initTheme('bb_theme'),
    );
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    try {
      $view = Views::getView('project_board');
      self::assertInstanceOf(ViewExecutable::class, $view);
      self::assertTrue($view->setDisplay('project_board'));
      $arguments = [(string) $this->fixture('a', 'bb_workspace')->id(), (string) $this->projectA->id()];
      $view->preExecute($arguments);
      $view->render();
      $columns = $view->attachment_before;
      return (string) $this->container->get('renderer')->renderInIsolation($columns);
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Column label and count of each rendered column, in order.
   *
   * @return array<string, int>
   *   Counts keyed by column label.
   */
  private function columns(string $html): array {
    preg_match_all('#<section[^>]*\sdata-col="([^"]+)"[^>]*\sdata-count="(\d+)"#', $html, $matches);
    return array_map('intval', array_combine($matches[1], $matches[2]));
  }

  /**
   * The visible text of rendered markup, one space between words.
   */
  private function text(string $html): string {
    return trim(preg_replace('/\s+/', ' ', html_entity_decode(preg_replace('/<[^>]+>/', ' ', $html))));
  }

  /**
   * The exposed identifiers of one board display.
   *
   * @return list<string>
   *   Identifiers in filter order.
   */
  private function exposedIdentifiers(string $display): array {
    $view = Views::getView('project_board');
    self::assertInstanceOf(ViewExecutable::class, $view);
    self::assertTrue($view->setDisplay($display));
    $view->initHandlers();
    $identifiers = [];
    foreach ($view->filter as $filter) {
      if ($filter->isExposed()) {
        $identifiers[] = $filter->options['expose']['identifier'];
      }
    }
    return $identifiers;
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
   * Creates a run of the ticket in the given state.
   */
  private function createRun(BbTicketInterface $ticket, string $state): BbRunInterface {
    $run = $this->createEntity('bb_run', [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $this->fixture('a', 'bb_conductor')->id(),
      'state' => $state,
      'claim_expires_at' => time() + 600,
    ]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    return $run;
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
