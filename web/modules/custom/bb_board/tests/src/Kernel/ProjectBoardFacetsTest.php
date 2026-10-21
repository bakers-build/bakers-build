<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\facets\Result\ResultInterface;
use Drupal\bb_board\BoardAddress;
use Drupal\bb_board\ProjectBoard;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_board\Plugin\views\area\BbBoardSummary;
use Drupal\KernelTests\KernelTestBase;
use Drupal\search_api\Entity\Index;
use Drupal\search_api\Plugin\views\query\SearchApiQuery;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Project Board's parent focus, facet chips and summary on indexed data.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectBoardFacetsTest extends KernelTestBase {

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
   * The member who reads the board.
   */
  private UserInterface $reader;

  /**
   * Assignee with twelve open descendants.
   */
  private UserInterface $alice;

  /**
   * Assignee with two open descendants.
   */
  private UserInterface $bob;

  /**
   * A conductor nobody owns, holding unassigned Working tickets.
   */
  private BbConductorInterface $ownerless;

  /**
   * Project A.
   */
  private BbProjectInterface $project;

  /**
   * The selected parent.
   */
  private BbTicketInterface $parent;

  /**
   * A ticket of the project with nothing below it.
   */
  private BbTicketInterface $leaf;

  /**
   * The done descendant.
   */
  private BbTicketInterface $merged;

  /**
   * The one High-priority descendant.
   */
  private BbTicketInterface $critical;

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
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->buildTwoWorkspaceWorld();

    $project = $this->fixture('a', 'bb_project');
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
    $this->reader = $this->createAccount('board-reader', [
      'view bb_ticket', 'view bb_project', 'view bb_conductor',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $this->reader, []);
    $this->alice = $this->createAccount('alice');
    $this->bob = $this->createAccount('bob');
    $ownerless = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-a-ownerless',
      'label' => 'node-a-ownerless',
      'status' => 'online',
      'project_id' => $this->project->id(),
      'owner_user_id' => 0,
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $ownerless);
    $this->ownerless = $ownerless;

    $this->seed();
  }

  /**
   * Fifteen open descendants, all Working: Alice 12, Bob 2, unassigned 1.
   *
   * Three of them are in review (Alice 2, Bob 1). One Alice ticket sits below
   * a closed Bob child, one is High priority. A done child and an unrelated
   * open ticket must never count in parent focus.
   */
  private function seed(): void {
    $this->parent = $this->ticket(NULL, 'review', NULL);
    $this->parent->set('title', 'Break & retry')->save();
    $closed = $this->ticket($this->parent, 'review', $this->bob, TRUE);
    for ($i = 0; $i < 12; $i++) {
      $this->ticket($i === 0 ? $closed : $this->parent, $i < 2 ? 'review' : 'coding', $this->alice);
    }
    $this->ticket($this->parent, 'review', $this->bob);
    $this->ticket($this->parent, 'coding', $this->bob);
    $this->critical = $this->ticket($this->parent, 'coding', NULL, FALSE, 1);
    $this->merged = $this->ticket($this->parent, 'done', $this->alice, TRUE);
    $this->ticket(NULL, 'coding', $this->alice);
    $this->leaf = $this->ticket(NULL, 'spec', NULL);
    $this->index();
  }

  /**
   * Summary counts span every page and column; columns stay paged.
   */
  public function testSummaryCountsTheWholeSelectionAcrossPages(): void {
    $input = ['parent_id' => $this->parent->uuid()];

    $working = $this->execute('working', $input);
    self::assertCount(10, $working->result);
    self::assertSame(15, (int) $working->total_rows);
    self::assertSame($this->critical->getIdentifier(), $this->identifiers($working)[0], 'High priority comes first.');

    $summary = $this->summary($input);
    self::assertSame('ok', $summary['status']);
    self::assertSame('parent', $summary['mode']);
    self::assertSame(15, $summary['total']);
    self::assertSame([['alice', 12], ['bob', 2], ['Unassigned', 1]], $this->employeeCounts($summary));
    self::assertSame(15, array_sum(array_column($summary['states'], 'count')));
    self::assertSame(3, $this->stateCount($summary, 'review'));
    self::assertSame(12, $this->stateCount($summary, 'coding'));
    self::assertNull($this->stateCount($summary, 'spec'), 'A state nobody is in is omitted.');

    // Moving one Alice card to Not assigned changes the columns,
    // not the people.
    $moved = $this->ticket($this->parent, 'coding', $this->alice);
    $moved->set('conductor_id', NULL)->save();
    $this->index();
    // A new request: the resolver memoizes per request.
    $this->container->set('bb_board.parent_ticket_scope', NULL);
    self::assertSame(1, (int) $this->execute('backlog', $input)->total_rows);
    self::assertSame(15, (int) $this->execute('working', $input)->total_rows);
    self::assertSame([['alice', 13], ['bob', 2], ['Unassigned', 1]], $this->employeeCounts($this->summary($input)));
  }

  /**
   * Chips are facets: each dimension counts without its own filter.
   *
   * Picking a person keeps everyone else's open work on screen, so the
   * workload stays visible; the total counts the whole selection.
   */
  public function testChipsCountWorkloadWithoutTheirOwnFilter(): void {
    $review = ['parent_id' => $this->parent->uuid(), 'state' => ['review']];
    $summary = $this->summary($review);
    self::assertSame(3, $summary['total']);
    self::assertSame([['alice', 2], ['bob', 1]], $this->employeeCounts($summary));
    self::assertSame(12, $this->stateCount($summary, 'coding'), 'The state chips ignore the state filter.');

    $alice = $review + ['assignee' => [(string) $this->alice->id()]];
    $summary = $this->summary($alice);
    self::assertSame(2, $summary['total']);
    self::assertSame([['alice', 2], ['bob', 1]], $this->employeeCounts($summary));
    self::assertTrue($summary['employees'][0]['active']);
    self::assertFalse($summary['employees'][1]['active']);
    self::assertSame(10, $this->stateCount($summary, 'coding'), 'The state chips keep the assignee filter.');
    $review_row = array_values(array_filter($summary['states'], static fn (array $row): bool => $row['value'] === 'review'))[0];
    self::assertTrue($review_row['active']);
  }

  /**
   * Priority chips are facets too, the missing priority included.
   */
  public function testPriorityChipsCountAndToggle(): void {
    $uuid = $this->parent->uuid();
    $summary = $this->summary(['parent_id' => $uuid]);
    $chips = array_map(static fn (array $row): array => [(string) $row['label'], $row['count']], $summary['priorities']);
    self::assertSame([['High', 1], ['No priority', 14]], $chips);
    self::assertSame('critical', $summary['priorities'][0]['tone']);
    self::assertArrayNotHasKey('tone', $summary['priorities'][1]);
    self::assertStringStartsWith('!(', (string) $summary['priorities'][1]['value']);

    $this->container->get('request_stack')->getCurrentRequest()->query->replace(['parent_id' => $uuid]);
    $html = $this->renderSummary($this->execute('project_board', ['parent_id' => $uuid]));
    self::assertMatchesRegularExpression('#<a [^>]*href="[^"]*priority%5B0%5D=1[^"]*"[^>]*>(?:(?!</a>)[\s\S])*High · 1#', $html);
    self::assertMatchesRegularExpression('#<a [^>]*class="[^"]*text-state-unassigned-ink[^"]*"[^>]*>[\s\S]*High · 1#', $html);
    self::assertSame(1, $this->summary(['parent_id' => $uuid, 'priority' => ['1']])['total']);
  }

  /**
   * A done card says when it was done, relatively, and links its MR.
   */
  public function testDoneCardShowsRelativeDoneDateAndMergeRequest(): void {
    $this->merged->set('links', [['uri' => 'https://git.example.com/acme/app/-/merge_requests/7', 'title' => 'MR !7']]);
    $this->merged->set('closed_date', $this->container->get('datetime.time')->getRequestTime() - 3 * 86400)->save();
    $cards = $this->container->get(ProjectBoard::class)->cards([$this->merged], 'done');
    self::assertSame('https://git.example.com/acme/app/-/merge_requests/7', $cards[0]['mr_url']);
    self::assertSame('3 days ago', $cards[0]['done_ago']);
    self::assertSame('MR !7', $cards[0]['mr_label']);

    $open = $this->container->get(ProjectBoard::class)->cards([$this->critical], 'working');
    self::assertArrayNotHasKey('done_ago', $open[0]);
    self::assertArrayNotHasKey('mr_url', $open[0]);
  }

  /**
   * State chips link to the same State facet value and drop pagers.
   */
  public function testStateChipsToggleTheStateFacet(): void {
    $uuid = $this->parent->uuid();
    $this->container->get('request_stack')->getCurrentRequest()->query->replace(['parent_id' => $uuid, 'page' => '0,1']);
    $html = $this->renderSummary($this->execute('project_board', ['parent_id' => $uuid]));
    self::assertMatchesRegularExpression('#<a [^>]*href="[^"]*state%5B0%5D=review[^"]*"[^>]*>(?:(?!</a>)[\s\S])*Review · 3#', $html);
    self::assertStringNotContainsString('page=', $html, 'A chip resets every column pager.');
  }

  /**
   * The Done chip keeps the parent, writes work_state and drops pagers.
   */
  public function testDoneChipPreservesParentAndDropsPagers(): void {
    $uuid = $this->parent->uuid();
    $this->container->get('request_stack')->getCurrentRequest()->query->replace([
      'parent_id' => $uuid,
      'page' => '0,1',
    ]);
    $html = $this->renderSummary($this->execute('project_board', ['parent_id' => $uuid]));
    self::assertStringNotContainsString('Show done', $html);
    self::assertStringNotContainsString('Board controls', $html);
    self::assertMatchesRegularExpression(
      '#<a [^>]*href="[^"]*work_state%5B3%5D=done[^"]*"[^>]*>(?:(?!</a>)[\s\S])*Done · #',
      $html,
    );
    self::assertStringNotContainsString('page=', $html, 'Toggling Done drops every column pager.');
    self::assertStringContainsString('parent_id=' . $uuid, $html);
  }

  /**
   * The Unassigned entry links to the facet's own missing-value selection.
   */
  public function testUnassignedSelectsOnlyUnassignedWork(): void {
    $input = ['parent_id' => $this->parent->uuid()];
    $unassigned = $this->summary($input)['employees'][2];
    self::assertSame('Unassigned', $unassigned['label']);
    self::assertSame('wait', $unassigned['tone']);
    self::assertStringStartsWith('!(', $unassigned['value']);

    $summary = $this->summary($input + ['assignee' => [$unassigned['value']]]);
    self::assertSame(1, $summary['total']);
    self::assertSame($this->critical->getIdentifier(), $this->identifiers($this->execute('working', $input + ['assignee' => [$unassigned['value']]]))[0]);
  }

  /**
   * The pickers offer the missing values by name, beside real people.
   */
  public function testPickersNameMissingValues(): void {
    $view = $this->execute('project_board', ['parent_id' => $this->parent->uuid()]);
    $labels = ['facets_assignee_user_id' => [], 'facets_priority' => []];
    foreach (array_keys($labels) as $filter) {
      foreach ($view->filter[$filter]->facet_results ?? [] as $result) {
        self::assertInstanceOf(ResultInterface::class, $result);
        $labels[$filter][] = (string) $result->getDisplayValue();
      }
    }
    self::assertEqualsCanonicalizing(['alice', 'bob', 'Unassigned'], $labels['facets_assignee_user_id']);
    self::assertContains('No priority', $labels['facets_priority']);
    self::assertContains('High', $labels['facets_priority']);
  }

  /**
   * Absent work_state filters the same as the three open columns.
   */
  public function testDefaultWorkStateFilterMatchesExplicitOpenStates(): void {
    $this->container->get('request_stack')->getCurrentRequest()->query->replace([]);
    $default = $this->summary([]);
    $explicit = $this->summary(['work_state' => BoardAddress::OPEN_WORK_STATES]);
    self::assertSame($explicit['total'], $default['total']);
    self::assertSame($this->employeeCounts($explicit), $this->employeeCounts($default));
    self::assertSame(
      array_column($explicit['states'], 'count'),
      array_column($default['states'], 'count'),
    );
    self::assertSame(
      array_column($explicit['work_states'], 'count'),
      array_column($default['work_states'], 'count'),
    );
    self::assertSame(2, $this->workStateCount($default, 'done'));
    $with_done = $this->summary(['work_state' => [...BoardAddress::OPEN_WORK_STATES, 'done']]);
    self::assertGreaterThan($default['total'], $with_done['total']);
  }

  /**
   * The default open columns are filtered without writing work_state.
   */
  public function testDefaultWorkStateDoesNotMaterializeExposedInput(): void {
    $this->container->get('request_stack')->getCurrentRequest()->query->replace([]);
    $view = $this->execute('project_board', []);
    self::assertArrayNotHasKey('work_state', $view->getExposedInput());
    self::assertArrayNotHasKey('work_state', $view->getRequest()->query->all());
  }

  /**
   * All four work-state chips render; the three open ones start active.
   */
  public function testWorkStateChipsDefaultToOpenColumns(): void {
    $uuid = $this->parent->uuid();
    $this->container->get('request_stack')->getCurrentRequest()->query->replace(['parent_id' => $uuid]);
    $summary = $this->summary(['parent_id' => $uuid]);
    self::assertSame(
      ['not_assigned', 'intake', 'working', 'done'],
      array_column($summary['work_states'], 'value'),
    );
    $active = array_column(
      array_filter($summary['work_states'], static fn (array $row): bool => $row['active']),
      'value',
    );
    self::assertSame(['not_assigned', 'intake', 'working'], $active);
    $working = array_values(array_filter($summary['work_states'], static fn (array $row): bool => $row['value'] === 'working'));
    self::assertSame('Working', $working[0]['label']);
    self::assertSame(15, $working[0]['count']);
    self::assertSame(
      ['wait', 'attention', 'running', 'idle'],
      array_column($summary['work_states'], 'tone'),
    );

    $html = $this->renderSummary($this->execute('project_board', ['parent_id' => $uuid]));
    self::assertMatchesRegularExpression('#<a [^>]*href="[^"]*work_state%5B0%5D=not_assigned[^"]*"[^>]*>(?:(?!</a>)[\s\S])*Working · 15#', $html);
    self::assertMatchesRegularExpression('#<a [^>]*aria-pressed="true"[^>]*>[\s\S]*Working · 15#', $html);
    self::assertMatchesRegularExpression('#<a [^>]*aria-pressed="false"[^>]*>[\s\S]*Done · #', $html);
    self::assertStringContainsString('bg-state-unassigned-tint', $html);
    self::assertStringContainsString('bg-state-attention-tint', $html);
    self::assertStringContainsString('bg-state-running-tint', $html);
    self::assertSame(15, $this->summary(['parent_id' => $uuid, 'work_state' => ['working']])['total']);
  }

  /**
   * Parent chips use eligible options and exclusive UUID toggles.
   */
  public function testParentChipsToggleTheParentFilter(): void {
    $uuid = $this->parent->uuid();
    $summary = $this->summary([]);
    $chip = array_values(array_filter($summary['parents'], static fn (array $row): bool => $row['value'] === $uuid));
    self::assertNotSame([], $chip);
    self::assertSame($this->parent->getIdentifier(), $chip[0]['label']);
    self::assertSame('Break & retry', $chip[0]['title']);
    self::assertGreaterThan(0, $chip[0]['count']);

    $this->container->get('request_stack')->getCurrentRequest()->query->replace([]);
    $html = $this->renderSummary($this->execute('project_board', []));
    self::assertMatchesRegularExpression(
      '#<a [^>]*href="[^"]*parent_id=' . preg_quote($uuid, '#') . '[^"]*"[^>]*>(?:(?!</a>)[\s\S])*' . preg_quote($this->parent->getIdentifier(), '#') . '#',
      $html,
    );

    $focused = $this->summary(['parent_id' => $uuid]);
    $active = array_values(array_filter($focused['parents'], static fn (array $row): bool => $row['active']));
    self::assertSame([$uuid], array_column($active, 'value'));
  }

  /**
   * Parent chips keep every eligible parent while one of them is focused.
   */
  public function testParentChipsStayOfferedWhileFocused(): void {
    $other = $this->ticket(NULL, 'coding', $this->alice);
    $this->ticket($other, 'coding', $this->bob);
    $this->index();
    $this->container->set('bb_board.parent_ticket_scope', NULL);
    $unfocused = $this->summary([]);
    $this->container->set('bb_board.parent_ticket_scope', NULL);
    $focused = $this->summary(['parent_id' => $this->parent->uuid()]);
    $uuids = array_column($focused['parents'], 'value');
    self::assertContains($this->parent->uuid(), $uuids);
    self::assertContains($other->uuid(), $uuids);
    self::assertSame(
      $this->parentChipCount($unfocused, $other->uuid()),
      $this->parentChipCount($focused, $other->uuid()),
    );
    self::assertSame(1, $this->parentChipCount($focused, $other->uuid()));
  }

  /**
   * The executed page keeps facet plugins and has no fulltext search.
   */
  public function testBoardViewHasFacetChipsAndNoSearch(): void {
    $view = $this->execute('project_board', ['parent_id' => $this->parent->uuid()]);
    foreach (['facets_state', 'facets_assignee_user_id', 'facets_priority', 'facets_work_state'] as $id) {
      self::assertArrayHasKey($id, $view->filter);
    }
    self::assertArrayHasKey('board_parent', $view->filter);
    self::assertArrayNotHasKey('search_api_fulltext', $view->filter);
    self::assertArrayNotHasKey('work_state', $view->filter, 'The page has no column predicate; chips use facets_work_state.');
  }

  /**
   * A leaf is a successful zero; a bad parent is a refusal that hides all.
   */
  public function testLeafIsZeroAndAnInvalidParentNeverWidens(): void {
    $leaf = $this->summary(['parent_id' => $this->leaf->uuid()]);
    self::assertSame('ok', $leaf['status']);
    self::assertSame(0, $leaf['total']);
    self::assertSame([], $this->employeeCounts($leaf));
    self::assertSame('No open descendants match these filters.', (string) $leaf['message']);
    self::assertSame(0, (int) $this->execute('working', ['parent_id' => $this->leaf->uuid()])->total_rows);

    foreach (['not-a-uuid', $this->fixture('b', 'bb_ticket')->uuid()] as $raw) {
      $invalid = $this->summary(['parent_id' => $raw]);
      self::assertSame('invalid', $invalid['status']);
      self::assertSame('Parent ticket is unavailable.', (string) $invalid['message']);
      self::assertSame(0, (int) $this->execute('working', ['parent_id' => $raw])->total_rows);
    }
  }

  /**
   * Without a parent the board keeps its whole project population.
   */
  public function testNoParentKeepsTheProjectBoard(): void {
    $summary = $this->summary([]);
    self::assertSame('project', $summary['mode']);
    // Default work_state is the three open columns, so the closed child and
    // the done child stay out. Done-column isolation still sees both.
    self::assertSame(19, $summary['total']);
    $this->container->get('request_stack')->getCurrentRequest()->query->replace([]);
    self::assertSame(2, (int) $this->execute('done', [])->total_rows);
  }

  /**
   * A failed search is an error, never a successful zero.
   */
  public function testBackendFailureIsNotZero(): void {
    $view = $this->view('project_board', ['parent_id' => $this->parent->uuid()]);
    $view->build();
    self::assertInstanceOf(SearchApiQuery::class, $view->query);
    $view->query->abort('Simulated backend failure.');
    $view->execute();
    $summary = $this->summaryOf($view);
    self::assertSame('error', $summary['status']);
    self::assertSame('Metrics could not be loaded.', (string) $summary['message']);
  }

  /**
   * Clear filters keeps the parent and Done, and drops every other filter.
   */
  public function testClearFiltersKeepsTheParent(): void {
    $uuid = $this->parent->uuid();
    $input = ['parent_id' => $uuid, 'state' => ['review'], 'work_state' => ['working'], 'page' => '0,1'];
    $this->container->get('request_stack')->getCurrentRequest()->query->replace($input);
    $html = $this->renderSummary($this->execute('project_board', $input));
    self::assertStringContainsString('Clear filters', $html);
    self::assertMatchesRegularExpression('#By work state[\s\S]*Clear filters[\s\S]*By state#', $html);
    self::assertStringContainsString('?parent_id=' . $uuid . '"', $html);

    $this->container->get('request_stack')->getCurrentRequest()->query->replace(['parent_id' => $uuid]);
    self::assertStringNotContainsString('Clear filters', $this->renderSummary($this->execute('project_board', ['parent_id' => $uuid])));
  }

  /**
   * Choosing the Done chip includes closed descendants in counts and cards.
   */
  public function testDoneChipKeepsOpenSummaryCounts(): void {
    $uuid = $this->parent->uuid();
    $open = $this->summary(['parent_id' => $uuid]);
    $this->container->get('request_stack')->getCurrentRequest()->query->replace([
      'parent_id' => $uuid,
      'work_state' => ['not_assigned', 'intake', 'working', 'done'],
    ]);
    $with_done = $this->summary([
      'parent_id' => $uuid,
      'work_state' => ['not_assigned', 'intake', 'working', 'done'],
    ]);
    self::assertSame(15, $open['total']);
    self::assertSame(2, $this->workStateCount($open, 'done'));
    self::assertSame(17, $with_done['total']);
    self::assertSame(2, $this->workStateCount($with_done, 'done'));
    self::assertSame(2, (int) $this->execute('done', ['parent_id' => $uuid])->total_rows);
  }

  /**
   * A deliberate abort is an empty result; only a failure with a reason errs.
   */
  public function testDeliberateAbortIsZeroNotFailure(): void {
    $view = $this->view('project_board', ['parent_id' => $this->parent->uuid()]);
    $view->build();
    self::assertInstanceOf(SearchApiQuery::class, $view->query);
    $view->query->getSearchApiQuery()?->abort();
    $view->execute();
    $summary = $this->summaryOf($view);
    self::assertSame('ok', $summary['status']);
    self::assertSame(0, $summary['total']);
  }

  /**
   * Every return path is uncacheable, the refusals too.
   */
  public function testRefusalsAreUncacheable(): void {
    $handler = $this->execute('project_board', ['parent_id' => 'not-a-uuid'])->header['bb_board_summary'] ?? NULL;
    self::assertInstanceOf(BbBoardSummary::class, $handler);
    $build = $handler->render();
    self::assertSame(0, $build['#cache']['max-age']);
    self::assertContains('url.query_args', $build['#cache']['contexts']);
  }

  /**
   * The rendered strip names readiness unavailable and every count.
   */
  public function testRenderedSummary(): void {
    $view = $this->execute('project_board', ['parent_id' => $this->parent->uuid()]);
    $handler = $view->header['bb_board_summary'] ?? NULL;
    self::assertInstanceOf(BbBoardSummary::class, $handler);
    $build = $handler->render();
    self::assertSame(0, $build['#cache']['max-age']);
    self::assertContains('user', $build['#cache']['contexts']);
    self::assertContains('url.query_args', $build['#cache']['contexts']);
    $html = $this->renderSummary($view);
    foreach ([
      'alice · 12', 'bob · 2', 'Unassigned · 1',
      $this->parent->getIdentifier() . ' ·',
    ] as $text) {
      self::assertStringContainsString($text, $html);
    }
    self::assertMatchesRegularExpression(
      '#<a [^>]*title="Break &amp; retry"[^>]*>[\s\S]*?<span class="button__label">'
      . preg_quote($this->parent->getIdentifier(), '#')
      . ' · \d+</span>#',
      $html,
    );
    self::assertStringNotContainsString('Show done', $html);
    self::assertStringNotContainsString('Board controls', $html);
    self::assertStringContainsString('By work state', $html);
    self::assertStringContainsString('Not assigned ·', $html);
    self::assertStringContainsString('Done ·', $html);
    self::assertStringNotContainsString('Clear filters', $html);
    self::assertMatchesRegularExpression('#<a [^>]*href="[^"]*state%5B0%5D=#', $html);
    self::assertDoesNotMatchRegularExpression('#<input[^>]*name="title#', $html);
    self::assertStringNotContainsString('→', $html, 'No branch pair is claimed.');
    self::assertStringNotContainsString('in current selection', $html, 'The board below shows the tickets.');
    self::assertStringNotContainsString('Ready to merge', $html);
    self::assertStringNotContainsString('Last merged', $html, 'The Done column shows merged work.');
    self::assertStringNotContainsString('Diagnose · 0', $html, 'A zero count is omitted.');
    self::assertStringNotContainsString('&amp;amp;', $html, 'A title is escaped once.');
  }

  /**
   * The rendered summary of an executed page display.
   */
  private function renderSummary(ViewExecutable $view): string {
    $handler = $view->header['bb_board_summary'] ?? NULL;
    self::assertInstanceOf(BbBoardSummary::class, $handler);
    $build = $handler->render();
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Creates one ticket in project A, Working unless closed.
   */
  private function ticket(?BbTicketInterface $parent, string $state, ?UserInterface $assignee, bool $closed = FALSE, ?int $priority = NULL): BbTicketInterface {
    $ticket = $this->createEntity('bb_ticket', [
      'title' => 'board facet ticket',
      'workflow' => 'bb_feature',
      'state' => $state,
      'closed' => $closed,
      'priority' => $priority,
      'project_id' => $this->project->id(),
      // A conductor's owner becomes the assignee on save, so unassigned
      // Working work is held by an owner-less conductor.
      'conductor_id' => $assignee === NULL ? $this->ownerless->id() : $this->fixture('a', 'bb_conductor')->id(),
      'parent_id' => $parent?->id(),
      'assignee_user_id' => $assignee?->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Indexes every pending ticket.
   */
  private function index(): void {
    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    $index->indexItems();
    self::assertSame(0, $index->getTrackerInstance()->getRemainingItemsCount(), 'An unindexed fixture proves nothing.');
  }

  /**
   * A prepared, unexecuted board display as the reader.
   *
   * @param string $display
   *   The display id.
   * @param array<string, mixed> $input
   *   The exposed input, as a browser would send it.
   */
  private function view(string $display, array $input): ViewExecutable {
    $this->container->get('current_user')->setAccount($this->reader);
    $view = Views::getView('project_board');
    self::assertInstanceOf(ViewExecutable::class, $view);
    self::assertTrue($view->setDisplay($display));
    $arguments = [(string) $this->fixture('a', 'bb_workspace')->id(), (string) $this->project->id()];
    $view->setArguments($arguments);
    $view->setExposedInput($input);
    $view->preExecute($arguments);
    return $view;
  }

  /**
   * An executed board display.
   *
   * @param string $display
   *   The display id.
   * @param array<string, mixed> $input
   *   The exposed input.
   */
  private function execute(string $display, array $input): ViewExecutable {
    $view = $this->view($display, $input);
    $view->execute($display);
    return $view;
  }

  /**
   * The page display's summary for one input.
   *
   * @param array<string, mixed> $input
   *   The exposed input.
   *
   * @return array<string, mixed>
   *   The summary data.
   */
  private function summary(array $input): array {
    return $this->summaryOf($this->execute('project_board', $input));
  }

  /**
   * The summary data of an executed page display.
   *
   * @return array<string, mixed>
   *   The summary data.
   */
  private function summaryOf(ViewExecutable $view): array {
    $handler = $view->header['bb_board_summary'] ?? NULL;
    self::assertInstanceOf(BbBoardSummary::class, $handler);
    return $handler->summary();
  }

  /**
   * Employee label/count pairs in display order.
   *
   * @param array<string, mixed> $summary
   *   The summary data.
   *
   * @return list<array{0: string, 1: int}>
   *   Label and count per entry.
   */
  private function employeeCounts(array $summary): array {
    return array_values(array_map(
      static fn (array $row): array => [(string) $row['label'], (int) $row['count']],
      $summary['employees'],
    ));
  }

  /**
   * One parent chip's count, or NULL when that parent is not listed.
   *
   * @param array<string, mixed> $summary
   *   The summary data.
   * @param string $uuid
   *   The parent ticket UUID.
   */
  private function parentChipCount(array $summary, string $uuid): ?int {
    foreach ($summary['parents'] as $row) {
      if ($row['value'] === $uuid) {
        return (int) $row['count'];
      }
    }
    return NULL;
  }

  /**
   * One work state's count, or NULL when the summary lists no such value.
   *
   * @param array<string, mixed> $summary
   *   The summary data.
   * @param string $value
   *   The work_state value.
   */
  private function workStateCount(array $summary, string $value): ?int {
    foreach ($summary['work_states'] as $row) {
      if ($row['value'] === $value) {
        return (int) $row['count'];
      }
    }
    return NULL;
  }

  /**
   * One state's count, or NULL when the summary lists no such state.
   *
   * @param array<string, mixed> $summary
   *   The summary data.
   * @param string $state
   *   The state machine name.
   */
  private function stateCount(array $summary, string $state): ?int {
    foreach ($summary['states'] as $row) {
      if ($row['value'] === $state) {
        return $row['count'];
      }
    }
    return NULL;
  }

  /**
   * Ticket identifiers of an executed display, in result order.
   *
   * @return list<string>
   *   The identifiers.
   */
  private function identifiers(ViewExecutable $view): array {
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

}
