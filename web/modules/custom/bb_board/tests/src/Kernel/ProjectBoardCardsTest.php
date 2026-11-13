<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\Tests\bb_core\Kernel\ClaimKernelTestBase;
use Drupal\bb_board\ProjectBoard;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Run facts and open blockers on board cards.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectBoardCardsTest extends ClaimKernelTestBase {

  /**
   * Cards name distinct completed targets, and omit planned deployments.
   */
  public function testClosedDeploymentEnvironments(): void {
    $this->installEntitySchema('bb_environment');
    $etm = $this->container->get('entity_type.manager');
    $ticket = $this->seedAssignedTicket('working');
    $type = $etm->getStorage('bb_term')->create(['vid' => 'type', 'name' => 'deployment']);
    $type->save();
    $ids = [];
    foreach (['develop', 'production'] as $name) {
      $environment = $etm->getStorage('bb_environment')->create([
        'name' => $name,
        'project_id' => $ticket->getProject()->id(),
      ]);
      $environment->save();
      $ids[] = $environment->id();
    }
    $deployment = $etm->getStorage('bb_ticket')->create([
      'title' => 'Release',
      'workflow' => 'bb_work',
      'ticket_type' => $type->id(),
      'project_id' => $ticket->getProject()->id(),
      'environments' => $ids,
      'referenced_tickets' => [$ticket->id()],
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $deployment);
    $deployment->save();
    self::assertArrayNotHasKey('deployed_to', $this->cards([$ticket])[0]);
    $deployment->set('closed', TRUE)->save();
    self::assertSame(['develop', 'production'], $this->cards([$ticket])[0]['deployed_to'] ?? []);
  }

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'filter', 'search_api', 'search_api_db',
    'bb_core', 'bb_activity',
  ];

  /**
   * The account that reads the board.
   */
  private UserInterface $viewer;

  /**
   * A project the viewer is not a member of.
   */
  private BbProjectInterface $hidden;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_activity');
    $project = $this->conductor->get('project_id')->entity;
    self::assertInstanceOf(BbProjectInterface::class, $project);
    // Created before the viewer is current: OG adds a group's creator.
    $this->hidden = $this->createProject('card-hidden');
    $this->viewer = $this->createViewer('card-viewer', $project);
    $this->container->get('current_user')->setAccount($this->viewer);
  }

  /**
   * Four runs, the newest failed: the card says so.
   */
  public function testCardCarriesRunCountAndLatestState(): void {
    $ticket = $this->seedAssignedTicket('working');
    foreach (['done', 'done', 'expired', 'failed'] as $state) {
      $this->seedRun($ticket, 'working', $state);
    }
    $other = $this->seedAssignedTicket('working');
    $this->seedRun($other, 'working', 'done');

    $cards = $this->cards([$ticket, $other]);

    self::assertSame(4, $cards[0]['run_count']);
    self::assertSame('failed', $cards[0]['last_run_state']);
    self::assertSame(1, $cards[1]['run_count']);
    self::assertSame('done', $cards[1]['last_run_state']);
  }

  /**
   * A ticket that never ran has no run facts.
   */
  public function testCardWithoutRunsHasNoRunFacts(): void {
    $card = $this->cards([$this->seedAssignedTicket('working')])[0];

    self::assertArrayNotHasKey('run_count', $card);
    self::assertArrayNotHasKey('last_run_state', $card);
  }

  /**
   * A running ticket stays running in a Details column of Working.
   */
  public function testRunningCardInDetailsColumn(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'running');

    self::assertSame('running', $this->cards([$ticket], 'working_working')[0]['status']);
  }

  /**
   * Only open blockers are listed; closed ones do not make a card blocked.
   */
  public function testBlockedByListsOnlyOpenBlockers(): void {
    $open = $this->seedAssignedTicket('working');
    $done = $this->seedAssignedTicket('working');
    $this->container->get('database')->update('bb_ticket')
      ->fields(['state' => 'done'])
      ->condition('id', $done->id())
      ->execute();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->resetCache();
    $blocked = $this->seedAssignedTicket('working');
    $blocked->set('blocked_by', [$done->id(), $open->id()])->save();
    $settled = $this->seedAssignedTicket('working');
    $settled->set('blocked_by', [$done->id()])->save();
    $free = $this->seedAssignedTicket('working');

    $cards = $this->cards([$blocked, $settled, $free]);

    self::assertSame([$open->getIdentifier()], $cards[0]['blocked_by']);
    self::assertFalse($cards[0]['blocked_hidden']);
    self::assertSame([], $cards[1]['blocked_by']);
    self::assertFalse($cards[1]['blocked_hidden']);
    self::assertSame([], $cards[2]['blocked_by']);
    self::assertFalse($cards[2]['blocked_hidden']);
  }

  /**
   * An open blocker the viewer may not see keeps the card blocked, unnamed.
   */
  public function testBlockedByHidesUnviewableBlocker(): void {
    $secret = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-SECRET',
      'workflow' => 'bb_work',
      'title' => 'Secret',
      'project_id' => $this->hidden->id(),
    ]);
    $secret->save();
    $visible = $this->seedAssignedTicket('working');
    $ticket = $this->seedAssignedTicket('working');
    $ticket->set('blocked_by', [$secret->id(), $visible->id()])->save();
    $only_hidden = $this->seedAssignedTicket('working');
    $only_hidden->set('blocked_by', [$secret->id()])->save();

    $cards = $this->cards([$ticket, $only_hidden]);

    self::assertSame([$visible->getIdentifier()], $cards[0]['blocked_by']);
    self::assertFalse($cards[0]['blocked_hidden']);
    self::assertSame([], $cards[1]['blocked_by']);
    self::assertTrue($cards[1]['blocked_hidden']);
  }

  /**
   * Board cards for the tickets, as one column.
   *
   * @param list<\Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   The tickets.
   * @param string $display
   *   The column display id.
   *
   * @return list<array<string, mixed>>
   *   The cards.
   */
  private function cards(array $tickets, string $display = 'working'): array {
    $board = new ProjectBoard(
      $this->container->get('bb_core.ticket_run_deriver'),
      $this->container->get('bb_core.date'),
      $this->container->get('bb_core.reference_counter'),
      $this->container->get('entity_type.manager'),
      $this->container->get('bb_core.deployment_lookup'),
    );
    $reloaded = [];
    foreach ($tickets as $ticket) {
      $reloaded[] = $this->reloadTicket($ticket);
    }
    return $board->cards($reloaded, $display);
  }

  /**
   * The group of a project, which names its workspace.
   */
  private function workspaceOf(?EntityInterface $project): ContentEntityInterface {
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $group = $project->get('group_id')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $group);
    return $group;
  }

  /**
   * Creates a project of its own team in the default workspace chain.
   */
  private function createProject(string $name): BbProjectInterface {
    $etm = $this->container->get('entity_type.manager');
    $group = $this->workspaceOf($this->conductor->get('project_id')->entity);
    $team = $etm->getStorage('bb_team')->create([
      'name' => $name . ' team',
      'workspace_id' => $group->get('workspace_id')->target_id,
    ]);
    $team->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => $name,
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    return $project;
  }

  /**
   * Creates a viewer who reads the project through its teams.
   */
  private function createViewer(string $name, BbProjectInterface $project): UserInterface {
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'r_' . $name, 'label' => $name])->save();
    user_role_grant_permissions('r_' . $name, ['view bb_ticket', 'view bb_run']);
    $account = $etm->getStorage('user')->create(['name' => $name, 'status' => 1, 'roles' => ['r_' . $name]]);
    $account->save();
    self::assertInstanceOf(UserInterface::class, $account);
    $workspace = $this->workspaceOf($project)->get('workspace_id')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    $this->addMembership($workspace, $account, ['member']);
    foreach ($project->get('teams')->referencedEntities() as $team) {
      $this->addMembership($team, $account);
    }
    return $account;
  }

}
