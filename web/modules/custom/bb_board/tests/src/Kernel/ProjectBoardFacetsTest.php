<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\facets\Result\ResultInterface;
use Drupal\bb_board\ProjectBoard;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_board\Plugin\views\area\BbBoardSummary;
use Drupal\bb_core\Plugin\views\filter\BbTicketSearch;
use Drupal\KernelTests\KernelTestBase;
use Drupal\search_api\Entity\Index;
use Drupal\search_api\Plugin\views\query\SearchApiQuery;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Project Board's parent focus, filter bar and summary on indexed data.
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
    // The attention set reads ticket activity.
    'bb_core', 'bb_activity', 'bb_board',
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
    $this->installSchema('user', ['users_data']);
    $this->installEntitySchema('bb_activity');
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
   * A done card says when it was done, relatively, and links its MR.
   */
  public function testDoneCardShowsRelativeDoneDateAndMergeRequest(): void {
    $this->merged->set('links', [['uri' => 'https://git.example.com/acme/app/-/merge_requests/7', 'title' => 'MR !7']]);
    $closed = $this->container->get('datetime.time')->getRequestTime() - 3 * 86400;
    $this->merged->set('closed_date', $closed)->save();
    $cards = $this->container->get(ProjectBoard::class)->cards([$this->merged], 'done');
    self::assertSame('https://git.example.com/acme/app/-/merge_requests/7', $cards[0]['mr_url']);
    self::assertSame('3 days ago', $cards[0]['done_label']);
    self::assertSame($closed, (new \DateTimeImmutable($cards[0]['done_datetime']))->getTimestamp());
    self::assertMatchesRegularExpression('/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} \S+$/', $cards[0]['done_title']);
    self::assertSame('MR !7', $cards[0]['mr_label']);

    $open = $this->container->get(ProjectBoard::class)->cards([$this->critical], 'working');
    self::assertArrayNotHasKey('done_label', $open[0]);
    self::assertArrayNotHasKey('mr_url', $open[0]);
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
   * The page exposes Search, State, Priority and Assignee, never Conductor.
   *
   * Work state is no filter any more: the columns are the work states.
   */
  public function testBoardViewHasFilterBarWithSearch(): void {
    $view = $this->execute('project_board', ['parent_id' => $this->parent->uuid()]);
    $identifiers = [];
    foreach ($view->filter as $id => $filter) {
      if ($filter->isExposed()) {
        $identifiers[$id] = $filter->options['expose']['identifier'];
      }
    }
    self::assertEqualsCanonicalizing(['parent_id', 'search', 'state', 'priority', 'assignee'], array_values($identifiers));
    self::assertInstanceOf(BbTicketSearch::class, $view->filter['bb_ticket_search']);
    self::assertSame('search', $identifiers['bb_ticket_search']);
    self::assertSame('parent_id', $identifiers['board_parent']);
    self::assertArrayNotHasKey('facets_work_state', $view->filter);
  }

  /**
   * Search narrows every column, by title words and by identifier.
   */
  public function testSearchNarrowsEveryColumn(): void {
    $working = $this->ticket(NULL, 'coding', $this->bob);
    $working->set('title', 'needle in the working column')->save();
    $backlog = $this->ticket(NULL, 'coding', NULL);
    $backlog->set('title', 'needle without a conductor')->set('conductor_id', NULL)->save();
    $this->index();

    $words = ['search' => 'needle'];
    self::assertSame([$backlog->getIdentifier()], $this->identifiers($this->execute('backlog', $words)));
    self::assertSame([$working->getIdentifier()], $this->identifiers($this->execute('working', $words)));
    self::assertSame(0, (int) $this->execute('intake', $words)->total_rows);
    self::assertSame(2, $this->summary($words)['total']);

    $identifier = ['search' => $this->critical->getIdentifier()];
    self::assertSame([$this->critical->getIdentifier()], $this->identifiers($this->execute('working', $identifier)));
    self::assertSame(0, (int) $this->execute('backlog', $identifier)->total_rows);
    self::assertSame(1, $this->summary($identifier)['total']);
  }

  /**
   * Unhealthy limits every column to the attention set and shows its chip.
   */
  public function testHealthFilterLimitsColumnsToUnhealthyTickets(): void {
    // The tickets on the owner-less conductor stay unhealthy: "Conductor has
    // no access". Every other ticket's conductor is owned by an admin.
    $this->ownConductorsByAnAdmin(FALSE);
    $unhealthy = [$this->parent, $this->critical, $this->leaf];
    $expected = array_map(static fn (BbTicketInterface $ticket): string => $ticket->getIdentifier(), $unhealthy);
    sort($expected);
    self::assertEqualsCanonicalizing(
      array_map(static fn (BbTicketInterface $ticket): int => (int) $ticket->id(), $unhealthy),
      $this->unhealthyIds(),
    );

    $input = ['health' => 'unhealthy'];
    $working = $this->identifiers($this->execute('working', $input));
    sort($working);
    self::assertSame($expected, $working);
    foreach (['backlog', 'intake', 'done'] as $display) {
      self::assertSame(0, (int) $this->execute($display, $input)->total_rows, $display);
    }
    $this->request($input);
    $summary = $this->summary($input);
    self::assertSame(3, $summary['total']);
    self::assertSame([['Unhealthy', [], 3]], $this->chips($summary));
    self::assertStringNotContainsString('health', $summary['chips'][0]['remove_url']);
    self::assertStringContainsString('Unhealthy · 3', $this->text($this->renderSummary($this->execute('project_board', $input))));

    self::assertSame(19, $this->summary(['health' => 'something-else'])['total'], 'Only "unhealthy" filters.');
  }

  /**
   * An empty attention set shows empty columns, never every ticket.
   */
  public function testHealthFilterWithEmptySetMatchesNothing(): void {
    $this->ownConductorsByAnAdmin(TRUE);
    self::assertSame([], $this->unhealthyIds());

    $input = ['health' => 'unhealthy'];
    foreach (['backlog', 'intake', 'working', 'done'] as $display) {
      $view = $this->execute($display, $input);
      self::assertSame([], $this->identifiers($view), $display);
      self::assertSame(0, (int) $view->total_rows, $display);
    }
    $summary = $this->summary($input);
    self::assertSame('ok', $summary['status']);
    self::assertSame(0, $summary['total']);
    self::assertSame(19, $this->summary([])['total'], 'Without the filter the board is full.');
  }

  /**
   * Each active chip counts what its own filter matches, beside the total.
   */
  public function testActiveChipCarriesMatchCount(): void {
    $review = $this->summary(['state' => ['review']])['total'];
    $input = ['priority' => ['1'], 'state' => ['review']];
    $this->request($input);
    $summary = $this->summary($input);
    self::assertSame(0, $summary['total'], 'The one High ticket is not in review.');
    self::assertSame([['State', ['Review'], $review], ['Priority', ['High'], 1]], $this->chips($summary));
    // The facet filter writes its own value shape back into the request.
    self::assertStringNotContainsString('priority', $summary['chips'][1]['remove_url']);
    self::assertStringContainsString('=review', $summary['chips'][1]['remove_url']);

    $text = $this->text($this->renderSummary($this->execute('project_board', $input)));
    self::assertStringContainsString('Priority is High · 1', $text);
    self::assertStringContainsString('State is Review · ' . $review, $text);
  }

  /**
   * The open total M of "N of M" is the board without its clearable filters.
   */
  public function testOpenTicketTotal(): void {
    $input = ['priority' => ['1']];
    $this->request($input);
    $summary = $this->summary($input);
    self::assertSame(1, $summary['total']);
    self::assertSame(19, $summary['open']);
    self::assertStringContainsString('1 of 19 open tickets', $this->text($this->renderSummary($this->execute('project_board', $input))));

    $focused = ['parent_id' => $this->parent->uuid(), 'priority' => ['1']];
    $this->request($focused);
    self::assertSame(15, $this->summary($focused)['open'], 'A parent focus is the board the filters narrow.');

    // Work state is no input any more: Done never joins the open count.
    $this->request(['work_state' => ['done']]);
    $done = $this->summary(['work_state' => ['done']]);
    self::assertSame(19, $done['total']);
    self::assertSame(19, $done['open']);
  }

  /**
   * The board's own URL names the project by key: counts and health follow.
   */
  public function testProjectKeyAddressCountsTheProject(): void {
    $key = $this->project->getKey();
    self::assertNotSame('', $key);
    $this->ownConductorsByAnAdmin(FALSE);
    $input = ['priority' => ['1'], 'health' => 'unhealthy'];
    $this->request($input);
    $summary = $this->summaryOf($this->execute('project_board', $input, $key));
    self::assertSame(1, $summary['total']);
    self::assertSame(19, $summary['open']);
    self::assertSame([['Priority', ['High'], 1], ['Unhealthy', [], 3]], $this->chips($summary));
    self::assertSame(1, (int) $this->execute('working', $input, $key)->total_rows);
  }

  /**
   * The parent focus is an active chip; removing it leaves the project board.
   */
  public function testParentFocusShowsAsActiveChip(): void {
    $uuid = $this->parent->uuid();
    $this->request(['parent_id' => $uuid, 'state' => ['review']]);
    $summary = $this->summary(['parent_id' => $uuid, 'state' => ['review']]);
    self::assertSame(
      [['Parent', [$this->parent->getIdentifier() . ' Break & retry'], 15], ['State', ['Review'], 3]],
      $this->chips($summary),
    );
    self::assertStringNotContainsString('parent_id', $summary['chips'][0]['remove_url']);
    self::assertStringContainsString('parent_id=' . $uuid, $summary['chips'][1]['remove_url']);
    $input = ['parent_id' => $uuid, 'state' => ['review']];
    $text = $this->text($this->renderSummary($this->execute('project_board', $input)));
    self::assertStringContainsString('Parent is ' . $this->parent->getIdentifier() . ' Break & retry · 15', $text);
    self::assertStringContainsString('3 of 15 open tickets', $text);
  }

  /**
   * The pickers count each value under every other filter, missing included.
   */
  public function testPickersCarryCounts(): void {
    $uuid = $this->parent->uuid();
    $summary = $this->summary(['parent_id' => $uuid]);
    $rows = array_map(static fn (array $row): array => [(string) $row['label'], $row['count']], $summary['priorities']);
    self::assertSame([['High', 1], ['No priority', 14]], $rows);
    self::assertStringStartsWith('!(', (string) $summary['priorities'][1]['value']);

    $this->request(['parent_id' => $uuid]);
    $html = $this->renderSummary($this->execute('project_board', ['parent_id' => $uuid]));
    self::assertMatchesRegularExpression($this->pickerRow('1', 'High', 1), $html);
    self::assertMatchesRegularExpression($this->pickerRow((string) $summary['priorities'][1]['value'], 'No priority', 14), $html);
    self::assertMatchesRegularExpression($this->pickerRow('review', 'Review', 3), $html);
    self::assertSame(1, $this->summary(['parent_id' => $uuid, 'priority' => ['1']])['total']);
  }

  /**
   * Clear filters keeps the parent and drops every other filter.
   */
  public function testClearFiltersKeepsTheParent(): void {
    $uuid = $this->parent->uuid();
    $input = ['parent_id' => $uuid, 'state' => ['review'], 'page' => '0,1'];
    $this->request($input);
    $html = $this->renderSummary($this->execute('project_board', $input));
    self::assertMatchesRegularExpression(
      '#<a [^>]*href="[^"]*\?parent_id=' . preg_quote($uuid, '#') . '"[^>]*>(?:(?!</a>)[\s\S])*Clear filters#',
      $html,
    );

    $this->request(['parent_id' => $uuid]);
    self::assertStringNotContainsString('Clear filters', $this->renderSummary($this->execute('project_board', ['parent_id' => $uuid])));
  }

  /**
   * The filter bar: search, pickers, avatars with counts and Details.
   */
  public function testRenderedSummary(): void {
    $uuid = $this->parent->uuid();
    $this->request(['parent_id' => $uuid]);
    $view = $this->execute('project_board', ['parent_id' => $uuid]);
    $handler = $view->header['bb_board_summary'] ?? NULL;
    self::assertInstanceOf(BbBoardSummary::class, $handler);
    $build = $handler->render();
    self::assertSame(0, $build['#cache']['max-age']);
    self::assertContains('user', $build['#cache']['contexts']);
    self::assertContains('url.query_args', $build['#cache']['contexts']);
    $html = $this->renderSummary($view);

    self::assertMatchesRegularExpression('#<input[^>]*name="search"#', $html);
    self::assertMatchesRegularExpression(
      '#<a\s(?=[^>]*aria-label="alice, 12 tickets")(?=[^>]*href="[^"]*assignee%5B0%5D=' . $this->alice->id() . '[^"]*")[^>]*>(?:(?!</a>)[\s\S])*data-person-mark[^>]*>A</span>(?:(?!</a>)[\s\S])*12#',
      $html,
    );
    self::assertMatchesRegularExpression('#<a\s(?=[^>]*aria-label="bob, 2 tickets")[^>]*>#', $html);
    self::assertDoesNotMatchRegularExpression('#<a\s[^>]*aria-current="true"#', $html, 'No assignee is chosen.');
    self::assertStringContainsString('Unassigned · 1', $html);
    self::assertMatchesRegularExpression('#<a\s[^>]*href="[^"]*details=states[^"]*"[^>]*>\s*States#', $html);
    self::assertMatchesRegularExpression('#<a\s[^>]*href="[^"]*details=phases[^"]*"[^>]*aria-current="page"[^>]*>\s*Phases#', $html);
    self::assertStringContainsString('Apply', $html, 'Without JavaScript the form still submits.');
    self::assertStringContainsString('15 of 15 open tickets', $this->text($html));
    foreach (['By work state', 'By state', 'By assignee', 'By priority', 'By parent'] as $gone) {
      self::assertStringNotContainsString($gone, $html, 'The chip groups are gone.');
    }
    self::assertStringNotContainsString('Clear filters', $html);
    self::assertStringNotContainsString('&amp;amp;', $html, 'A title is escaped once.');
  }

  /**
   * In the theme, the exposed form is one filter bar with Details at its end.
   */
  public function testFilterBarRendersAsOneToolbar(): void {
    $this->container->get('theme.manager')->setActiveTheme(
      $this->container->get('theme.initialization')->initTheme('bb_theme'),
    );
    $input = ['parent_id' => $this->parent->uuid(), 'assignee' => [(string) $this->bob->id()]];
    $this->request($input);
    $html = $this->renderSummary($this->execute('project_board', $input));
    self::assertMatchesRegularExpression(
      '#role="search"[^>]*aria-label="Board filters"[\s\S]*name="search"[\s\S]*name="state\[\]"[\s\S]*name="priority\[\]"[\s\S]*aria-label="bob, 2 tickets"[\s\S]*details=states[\s\S]*Clear filters#',
      $html,
    );
    self::assertMatchesRegularExpression('#<input type="hidden" name="assignee\[\]" value="' . $this->bob->id() . '">#', $html);
    self::assertMatchesRegularExpression('#<input type="hidden" name="parent_id" value="' . $this->parent->uuid() . '">#', $html);
    self::assertStringNotContainsString('name="assignee[]" value="' . $this->alice->id() . '"', $html, 'Avatars are links, not inputs.');
    self::assertMatchesRegularExpression('#<a\s(?=[^>]*aria-label="bob, 2 tickets")(?=[^>]*aria-current="true")[^>]*>#', $html, 'The chosen assignee is on.');
    self::assertMatchesRegularExpression('#<a\s(?=[^>]*aria-label="alice, 12 tickets")(?![^>]*aria-current)[^>]*>#', $html);
  }

  /**
   * Gives the board's conductors an owner who may work in the project.
   *
   * @param bool $ownerless
   *   Whether the owner-less conductor gets that owner too.
   */
  private function ownConductorsByAnAdmin(bool $ownerless): void {
    $admin = $this->createAccount('conductor-admin', ['administer bakers']);
    $conductors = [$this->fixture('a', 'bb_conductor')];
    if ($ownerless) {
      $conductors[] = $this->ownerless;
    }
    foreach ($conductors as $conductor) {
      $conductor->set('owner_user_id', $admin->id())->save();
    }
  }

  /**
   * The attention set as the reader sees it.
   *
   * @return list<int>
   *   Ticket ids.
   */
  private function unhealthyIds(): array {
    $this->container->get('current_user')->setAccount($this->reader);
    return $this->container->get('bb_core.project_health')->unhealthyIds($this->project);
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
   * Field, values and count of each active chip, in order.
   *
   * @param array<string, mixed> $summary
   *   The summary data.
   *
   * @return list<array{0: mixed, 1: mixed, 2: mixed}>
   *   One triple per chip.
   */
  private function chips(array $summary): array {
    return array_values(array_map(
      static fn (array $chip): array => [$chip['field'], $chip['values'], $chip['count']],
      $summary['chips'],
    ));
  }

  /**
   * The visible text of rendered markup, one space between words.
   */
  private function text(string $html): string {
    return trim(preg_replace('/\s+/', ' ', html_entity_decode(preg_replace('/<[^>]+>/', ' ', $html))));
  }

  /**
   * A picker row with its value, label and count.
   */
  private function pickerRow(string $value, string $label, int $count): string {
    return '#data-value="' . preg_quote(htmlspecialchars($value), '#') . '">(?:(?!</li>)[\s\S])*>'
      . preg_quote($label, '#') . '</span>(?:(?!</li>)[\s\S])*tabular-nums[^>]*>' . $count . '</span>#';
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
      'workflow' => 'bb_work',
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
   * @param string|null $project
   *   The project argument as the URL gives it, the id by default.
   */
  private function view(string $display, array $input, ?string $project = NULL): ViewExecutable {
    $this->container->get('current_user')->setAccount($this->reader);
    $view = Views::getView('project_board');
    self::assertInstanceOf(ViewExecutable::class, $view);
    self::assertTrue($view->setDisplay($display));
    $arguments = [(string) $this->fixture('a', 'bb_workspace')->id(), $project ?? (string) $this->project->id()];
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
   * @param string|null $project
   *   The project argument as the URL gives it, the id by default.
   */
  private function execute(string $display, array $input, ?string $project = NULL): ViewExecutable {
    $view = $this->view($display, $input, $project);
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
