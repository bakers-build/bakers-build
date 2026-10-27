<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Access\FigureDisclosure;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\Entity\Role;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the shipped workspace Insights figures: who sees them, what counts.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceInsightsFiguresTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use InsightsFixtureTrait;

  private const NOW = 1789920000;

  private const FIGURES = self::INSIGHTS_FIGURES;

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
   * The workspace under test.
   */
  private BbWorkspaceInterface $north;

  /**
   * The other bakery's workspace.
   */
  private BbWorkspaceInterface $south;

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
    $this->installInsightsFigures();
    $this->north = $this->workspace('north');
    $this->south = $this->workspace('south');
  }

  /**
   * A lead of the workspace sees every Insights figure.
   */
  public function testWorkspaceLeadSeesWorkspaceFigures(): void {
    $lead = $this->member($this->north, 'north-lead', ['lead']);
    foreach (self::FIGURES as $id) {
      self::assertTrue($this->mayView($lead, $id, $this->north), "The lead sees $id.");
    }
  }

  /**
   * Contributors, members and guests of the workspace see none of them.
   */
  public function testWorkspaceContributorMemberGuestAreDenied(): void {
    foreach (['contributor', 'member', 'guest'] as $rank) {
      $account = $this->member($this->north, 'north-' . $rank, [$rank]);
      foreach (self::FIGURES as $id) {
        self::assertFalse($this->mayView($account, $id, $this->north), "A $rank does not see $id.");
      }
    }
  }

  /**
   * A lead of another workspace sees nothing of this one.
   */
  public function testForeignWorkspaceLeadIsDenied(): void {
    $southLead = $this->member($this->south, 'south-lead', ['lead']);
    foreach (self::FIGURES as $id) {
      self::assertTrue($this->mayView($southLead, $id, $this->south));
      self::assertFalse($this->mayView($southLead, $id, $this->north), "A foreign lead does not see $id.");
    }
  }

  /**
   * The statistics outsider role discloses no workspace figure.
   */
  public function testStatisticsOutsiderIsDenied(): void {
    Role::create(['id' => 'api_statistics_outsider', 'label' => 'Outsider'])
      ->grantPermission('view bb_project')
      ->grantPermission('view bb_ticket')
      ->save();
    $outsider = $this->account('outsider');
    $outsider->addRole('api_statistics_outsider');
    $outsider->save();
    foreach (self::FIGURES as $id) {
      self::assertFalse($this->mayView($outsider, $id, $this->north));
    }
  }

  /**
   * Every workspace figure counts only its own workspace's data.
   */
  public function testWorkspaceFiguresCountOnlyOwnWorkspace(): void {
    $alice = $this->member($this->north, 'alice', ['member']);
    $own = $this->project($this->north, 'atlas');
    $foreign = $this->project($this->south, 'south-shop');
    $this->closedTicket($own, $alice, 1000, 'claude-opus');
    $this->closedTicket($foreign, $alice, 5000, 'claude-opus');

    $overview = $this->values('workspace_overview')['measurements'];
    $byId = array_column($overview, 'values', 'id');
    self::assertSame(1, $byId['closed_tickets']['total']);
    self::assertSame(1000, $byId['run_tokens']['total']);
    self::assertSame(1, $byId['runs']['total']);
    self::assertSame([$own->uuid()], array_column($this->values('workspace_projects')['categories'], 'key'));
    self::assertSame([$alice->uuid()], array_column($this->values('workspace_people')['categories'], 'key'));
    self::assertSame(['claude-opus' => 1000], $this->values('workspace_models')['measurements'][0]['values']);
  }

  /**
   * The model bars and the project bars each add up to the AI usage tile.
   */
  public function testModelAndProjectTokenBarsSumToTile(): void {
    $alice = $this->member($this->north, 'alice', ['member']);
    $atlas = $this->project($this->north, 'atlas');
    $pfiff = $this->project($this->north, 'pfiff');
    $this->closedTicket($atlas, $alice, 1200, 'claude-opus');
    $this->closedTicket($pfiff, $alice, 300, 'claude-sonnet');
    $this->closedTicket($pfiff, NULL, 500, '');

    $tile = array_column($this->values('workspace_overview')['measurements'], 'values', 'id')['run_tokens']['total'];
    self::assertSame(2000, $tile);
    self::assertSame($tile, array_sum($this->values('workspace_models')['measurements'][0]['values']));
    self::assertSame($tile, array_sum($this->values('workspace_projects_tokens')['measurements'][0]['values']));
  }

  /**
   * People rows name the person, their teams in the workspace and unassigned.
   */
  public function testPeopleTableShowsCommaJoinedTeamsAndUnassignedRow(): void {
    $alice = $this->member($this->north, 'Alice Baker', ['member']);
    foreach (['Platform crew', 'Design crew'] as $name) {
      $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
        ->create(['name' => $name, 'workspace_id' => $this->north->id()]);
      $team->save();
      $this->addMembership($team, $alice, ['member']);
    }
    $southTeam = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->create(['name' => 'South crew', 'workspace_id' => $this->south->id()]);
    $southTeam->save();
    $this->addMembership($southTeam, $alice, ['member']);
    $atlas = $this->project($this->north, 'atlas');
    $this->closedTicket($atlas, $alice, 10, 'claude-opus');
    $this->closedTicket($atlas, NULL, 10, 'claude-opus');

    $renderer = $this->container->get('bb_core.figure_renderer');
    $widgets = (new \ReflectionMethod($renderer, 'widget'))->invoke($renderer, $this->values('workspace_people'), ['workspace' => $this->north]);
    $byName = [];
    foreach ($widgets['table']['#props']['rows'] as $row) {
      $byName[$row['cells']['label']['display_name']] = $row['cells'];
    }
    self::assertSame(['Alice Baker', 'Unassigned tickets'], array_keys($byName));
    self::assertSame('person', $byName['Alice Baker']['label']['kind']);
    self::assertSame('Design crew, Platform crew', $byName['Alice Baker']['team']['value']);
    self::assertSame('—', $byName['Unassigned tickets']['team']['value']);
    self::assertStringContainsString('Values belong to the current assignee.', $widgets['footnotes']['#props']['lead']);
  }

  /**
   * The period buttons stay off a page that places its own period range.
   */
  public function testPeriodControlIsSuppressedWhenRequested(): void {
    $lead = $this->member($this->north, 'north-lead', ['lead']);
    $renderer = $this->container->get('bb_core.figure_renderer');
    self::assertNotSame('', $renderer->build(['workspace' => $this->north], $lead)['#slots']['actions']);
    self::assertSame('', $renderer->build(['workspace' => $this->north], $lead, [], ['controls' => FALSE])['#slots']['actions']);
  }

  /**
   * The Insights layout is compact: no group heading or figure description.
   *
   * The four tiles sit in one row.
   */
  public function testInsightsLayoutIsCompact(): void {
    $lead = $this->member($this->north, 'north-lead', ['lead']);
    $this->closedTicket($this->project($this->north, 'atlas'), $lead, 10, 'claude-opus');
    $renderer = $this->container->get('bb_core.figure_renderer');
    $build = $renderer->build(['workspace' => $this->north], $lead, [], ['controls' => FALSE, 'layout' => 'insights']);
    self::assertSame('', $build['#slots']['content']['insights']['#slots']['heading']);
    $figures = $build['#slots']['content']['insights']['#slots']['content'];
    foreach ($figures as $id => $figure) {
      self::assertSame('', $figure['#props']['description'], "$id carries no description line.");
    }
    self::assertSame(4, $figures['workspace_overview']['#slots']['content']['#props']['columns']);
  }

  /**
   * Whether an account may view one shipped figure in a workspace.
   */
  private function mayView(UserInterface $account, string $figureId, BbWorkspaceInterface $workspace): bool {
    $figure = BbFigure::load($figureId);
    self::assertInstanceOf(BbFigureInterface::class, $figure);
    $disclosure = $this->container->get('bb_core.figure_disclosure');
    self::assertInstanceOf(FigureDisclosure::class, $disclosure);
    return $disclosure->mayView($account, $figure, ['workspace' => $workspace]);
  }

  /**
   * Evaluates one shipped figure for the north workspace this month.
   *
   * @return array<string, mixed>
   *   The payload.
   */
  private function values(string $figureId): array {
    $evaluator = $this->container->get('bb_core.figure_evaluator');
    self::assertInstanceOf(FigureEvaluator::class, $evaluator);
    return $evaluator->evaluate(BbFigure::load($figureId), ['workspace' => $this->north], [], self::NOW)->toArray();
  }

  /**
   * Creates a workspace.
   */
  private function workspace(string $name): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create(['name' => $name]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    return $workspace;
  }

  /**
   * Creates a project in a workspace.
   */
  private function project(BbWorkspaceInterface $workspace, string $name): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $workspace->id()]);
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
   * Creates an account with a rank in a workspace.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param string $name
   *   The account name.
   * @param array<string> $ranks
   *   The OG role names.
   */
  private function member(BbWorkspaceInterface $workspace, string $name, array $ranks): UserInterface {
    $account = $this->account($name);
    $this->addMembership($workspace, $account, $ranks);
    return $account;
  }

  /**
   * Creates a ticket closed yesterday with one run.
   */
  private function closedTicket(BbProjectInterface $project, ?UserInterface $assignee, int $tokens, string $model): void {
    $storage = $this->container->get('entity_type.manager');
    $ticket = $storage->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'insights-' . mt_rand(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee?->id(),
      'created' => self::NOW - 86400,
      'closed' => TRUE,
      'closed_date' => self::NOW - 86400,
    ]);
    $ticket->save();
    $storage->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'running',
      'state_at_start' => 'working',
      'created' => self::NOW - 86400,
      'model' => $model,
      'tokens' => $tokens,
    ])->save();
  }

}
