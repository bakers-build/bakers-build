<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\Figure\FigureCollection;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\bb_core\Statistics\Figure\FigureFilterResolver;
use Drupal\bb_core\Statistics\FigureRenderer;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the shipped My work figures: who sees them, what counts.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MyWorkFiguresTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use InsightsFixtureTrait;

  private const NOW = 1789920000;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * The workspace the tickets live in.
   */
  private BbWorkspaceInterface $north;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_comment',
      'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    $this->account('uid1-dummy');
    $this->installMyWorkFigures();
    $north = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create(['name' => 'north']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $north);
    $north->save();
    $this->north = $north;
  }

  /**
   * My work lists the four figures in one group, in Figma order.
   */
  public function testMyWorkGroupListsFourFigures(): void {
    $alice = $this->account('alice');
    $groups = $this->collection()->groups(['user' => $alice], $alice, [], self::NOW);
    self::assertSame(['my_work'], array_column($groups, 'id'));
    self::assertSame(self::MY_WORK_FIGURES, array_column($groups[0]['figures'], 'id'));
  }

  /**
   * Any signed-in account sees its own figures and nobody else's.
   */
  public function testEveryAccountSeesOnlyOwnFigures(): void {
    $alice = $this->account('alice');
    $bob = $this->account('bob');
    self::assertNotSame([], $this->collection()->groups(['user' => $alice], $alice, [], self::NOW));
    self::assertSame([], $this->collection()->groups(['user' => $bob], $alice, [], self::NOW));
  }

  /**
   * The overview counts only the tickets currently assigned to the account.
   */
  public function testOverviewCountsOnlyMyTickets(): void {
    $alice = $this->account('alice');
    $bob = $this->account('bob');
    $project = $this->project('atlas');
    for ($n = 0; $n < 6; $n++) {
      $this->closedTicket($project, $alice);
    }
    for ($n = 0; $n < 3; $n++) {
      $this->closedTicket($project, $bob);
    }
    self::assertSame(6, $this->closed($alice));
  }

  /**
   * A ticket reassigned to someone else leaves the account's figures.
   */
  public function testFiguresFollowCurrentAssignee(): void {
    $alice = $this->account('alice');
    $bob = $this->account('bob');
    $project = $this->project('atlas');
    $ticket = $this->closedTicket($project, $alice);
    $this->closedTicket($project, $alice);
    self::assertSame(2, $this->closed($alice));
    $ticket->set('assignee_user_id', $bob->id())->save();
    self::assertSame(1, $this->closed($alice));
  }

  /**
   * A project filter narrows the account's figures to that project.
   */
  public function testProjectFilterNarrows(): void {
    $alice = $this->account('alice');
    $atlas = $this->project('atlas');
    $pfiff = $this->project('pfiff');
    $this->closedTicket($atlas, $alice);
    $this->closedTicket($atlas, $alice);
    $this->closedTicket($pfiff, $alice);
    self::assertSame(3, $this->closed($alice));
    self::assertSame(2, $this->closed($alice, ['project' => [$atlas->uuid()]]));
  }

  /**
   * A project without a ticket of the account is dropped, never narrowed to.
   */
  public function testProjectFilterRejectsForeignProject(): void {
    $alice = $this->account('alice');
    $own = $this->project('atlas');
    $foreign = $this->project('secret');
    $this->closedTicket($own, $alice);
    $this->closedTicket($foreign, $this->account('bob'));
    $resolver = $this->container->get('bb_core.figure_filter_resolver');
    self::assertInstanceOf(FigureFilterResolver::class, $resolver);
    self::assertSame([$own->uuid()], $resolver->accepted('project', [$foreign->uuid(), $own->uuid()], $alice));

    $this->expectException(\InvalidArgumentException::class);
    $this->closed($alice, ['project' => [$foreign->uuid()]]);
  }

  /**
   * My closed tickets lists closed tickets only, with runs in the period.
   */
  public function testTicketTableListsOnlyClosedTickets(): void {
    $alice = $this->account('alice');
    $atlas = $this->project('atlas');
    $now = $this->requestTime();
    $closed = $this->closedTicket($atlas, $alice, $now - 1);
    // Its only run started before the period.
    $this->createRun($closed, $now - 90 * 86400);
    $open = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'still open',
      'project_id' => $atlas->id(),
      'assignee_user_id' => $alice->id(),
      'created' => $now - 1,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $open);
    $open->save();
    $this->createRun($open, $now - 1);

    $rows = $this->figures($alice)['user_tickets']['table']['#props']['rows'];
    self::assertCount(1, $rows);
    self::assertSame('0', $rows[0]['cells']['runs']['value']);
  }

  /**
   * A ticket row links to the ticket under its identifier and title.
   */
  public function testTicketCellLinksToTicket(): void {
    $alice = $this->account('alice');
    $project = $this->project('atlas');
    $project->set('key', 'ATL')->save();
    $ticket = $this->closedTicket($project, $alice, $this->requestTime() - 1);

    $cell = $this->figures($alice)['user_tickets']['table']['#props']['rows'][0]['cells']['label'];
    self::assertSame('link', $cell['kind']);
    self::assertSame($ticket->get('identifier')->value . ' · ' . $ticket->label(), $cell['value']);
    self::assertStringStartsWith('ATL-', $cell['value']);
    self::assertSame($ticket->toUrl()->toString(), $cell['url']);
  }

  /**
   * My projects has no total row; a subtitle replaces the description.
   */
  public function testMyProjectsHasNoTotalRowAndCarriesItsSubtitle(): void {
    $alice = $this->account('alice');
    $this->closedTicket($this->project('atlas'), $alice, $this->requestTime() - 1);
    $build = $this->build($alice, ['subtitles' => ['user_projects' => 'Where your closed tickets and runs went.']]);
    $figure = $build['#slots']['content']['my_work']['#slots']['content']['user_projects'];
    self::assertSame('Where your closed tickets and runs went.', $figure['#props']['description']);
    $rows = $figure['#slots']['content']['#slots']['content']['table']['#props']['rows'];
    self::assertSame(['atlas'], array_map(static fn(array $row): string => $row['cells']['label']['value'], $rows));
    self::assertSame(['label', 'closed', 'runs', 'rating', 'tokens'], array_column($figure['#slots']['content']['#slots']['content']['table']['#props']['columns'], 'key'));
  }

  /**
   * The rendered My work page for an account.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account.
   * @param array<string, mixed> $options
   *   Extra renderer options.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function build(UserInterface $account, array $options = []): array {
    $renderer = $this->container->get('bb_core.figure_renderer');
    self::assertInstanceOf(FigureRenderer::class, $renderer);
    return $renderer->build(['user' => $account], $account, [], ['controls' => FALSE, 'layout' => 'insights'] + $options);
  }

  /**
   * Each My work figure's widgets, keyed by figure id.
   *
   * @return array<string, array<string, mixed>>
   *   The widgets.
   */
  private function figures(UserInterface $account): array {
    return array_map(
      static fn(array $figure): array => $figure['#slots']['content']['#slots']['content'],
      $this->build($account)['#slots']['content']['my_work']['#slots']['content'],
    );
  }

  /**
   * The request time the renderer evaluates at.
   */
  private function requestTime(): int {
    return $this->container->get('datetime.time')->getRequestTime();
  }

  /**
   * Creates a run on a ticket.
   */
  private function createRun(BbTicketInterface $ticket, int $created, int $tokens = 0): void {
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'running',
      'state_at_start' => 'working',
      'created' => $created,
      'tokens' => $tokens,
    ])->save();
  }

  /**
   * Closed tickets on the account's overview this month.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account.
   * @param array<string, string|list<string>> $filters
   *   The selected filters.
   */
  private function closed(UserInterface $account, array $filters = []): int {
    $evaluator = $this->container->get('bb_core.figure_evaluator');
    self::assertInstanceOf(FigureEvaluator::class, $evaluator);
    $payload = $evaluator->evaluate(BbFigure::load('user_overview'), ['user' => $account], $filters, self::NOW)->toArray();
    return (int) array_column($payload['measurements'], 'values', 'id')['closed_tickets']['total'];
  }

  /**
   * The figure collection service.
   */
  private function collection(): FigureCollection {
    $collection = $this->container->get('bb_core.figure_collection');
    self::assertInstanceOf(FigureCollection::class, $collection);
    return $collection;
  }

  /**
   * Creates a project in the north workspace.
   */
  private function project(string $name): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $this->north->id()]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create(['name' => $name, 'group_id' => $group->id()]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates an account.
   */
  private function account(string $name): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $account);
    $account->save();
    return $account;
  }

  /**
   * Creates a ticket closed yesterday, or at the given time.
   */
  private function closedTicket(BbProjectInterface $project, UserInterface $assignee, ?int $closed = NULL): BbTicketInterface {
    $closed ??= self::NOW - 86400;
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'my-work-' . mt_rand(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee->id(),
      'created' => $closed,
      'closed' => TRUE,
      'closed_date' => $closed,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

}
