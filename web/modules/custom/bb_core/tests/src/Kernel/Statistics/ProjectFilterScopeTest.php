<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\Figure\FigureFilterResolver;
use Drupal\bb_core\Statistics\Figure\WorkspaceFilterScope;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the project scope of figure filters: epics and people of a project.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectFilterScopeTest extends KernelTestBase {

  use EpicTermTrait;

  use OgScopeFixtureTrait;

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
   * The project under test.
   */
  private BbProjectInterface $project;

  /**
   * The project's epic.
   */
  private BbTicketInterface $epic;

  /**
   * The epic of another project in the same workspace.
   */
  private BbTicketInterface $foreignEpic;

  /**
   * A ticket of the project that is not an epic.
   */
  private BbTicketInterface $plain;

  /**
   * The assignee of the project's tickets.
   */
  private UserInterface $assignee;

  /**
   * A workspace member without a ticket in the project.
   */
  private UserInterface $bystander;

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
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create(['name' => 'north']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $this->project = $this->project($workspace, 'atlas');
    $other = $this->project($workspace, 'pfiff');
    $this->assignee = $this->account('alice');
    $this->bystander = $this->account('bob');
    $this->addMembership($workspace, $this->bystander, ['member']);
    $this->epic = $this->ticket($this->project, 'epic', NULL);
    $this->ticket($this->project, 'bb_work', $this->assignee);
    $this->plain = $this->ticket($this->project, 'bb_work', $this->assignee);
    $this->foreignEpic = $this->ticket($other, 'epic', NULL);
  }

  /**
   * A project scope holds its own epics and the assignees of its tickets.
   */
  public function testProjectScopeContainsOnlyItsEpicsAndAssignees(): void {
    $scope = $this->container->get('bb_core.workspace_filter_scope');
    self::assertInstanceOf(WorkspaceFilterScope::class, $scope);
    self::assertTrue($scope->contains($this->project, $this->epic));
    self::assertFalse($scope->contains($this->project, $this->foreignEpic), 'An epic of another project is outside.');
    self::assertFalse($scope->contains($this->project, $this->plain), 'A ticket that is no epic is no epic filter value.');
    self::assertTrue($scope->contains($this->project, $this->assignee));
    self::assertFalse($scope->contains($this->project, $this->bystander), 'A workspace member without a project ticket is outside.');
    self::assertFalse($scope->contains($this->project, $this->project));
  }

  /**
   * The page keeps only the selected epics the project accepts.
   */
  public function testAcceptedDropsForeignAndNonEpicTickets(): void {
    self::assertSame([$this->epic->uuid()], $this->resolver()->accepted('epic', [
      $this->epic->uuid(), $this->foreignEpic->uuid(), $this->plain->uuid(),
    ], $this->project));
  }

  /**
   * The API refuses an epic of another project.
   */
  public function testResolveRefusesForeignEpic(): void {
    $this->expectException(\InvalidArgumentException::class);
    $this->resolver()->resolve(
      ['epic' => ['label' => 'Epic', 'type' => 'entities', 'binding' => 'epic']],
      ['epic' => [$this->foreignEpic->uuid()]],
      ['project' => $this->project],
    );
  }

  /**
   * The API resolves an epic of the project to its entity.
   */
  public function testResolveAcceptsOwnEpic(): void {
    $resolved = $this->resolver()->resolve(
      ['epic' => ['label' => 'Epic', 'type' => 'entities', 'binding' => 'epic']],
      ['epic' => [$this->epic->uuid()]],
      ['project' => $this->project],
    );
    self::assertSame([$this->epic->uuid()], $resolved['epic']['value']);
  }

  /**
   * The filter resolver service.
   */
  private function resolver(): FigureFilterResolver {
    $resolver = $this->container->get('bb_core.figure_filter_resolver');
    self::assertInstanceOf(FigureFilterResolver::class, $resolver);
    return $resolver;
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
   * Creates a ticket in a project.
   */
  private function ticket(BbProjectInterface $project, string $workflow, ?UserInterface $assignee): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'ticket_type' => $workflow === 'epic' ? $this->epicTerm($project)->id() : NULL,
      'title' => 'scope-' . mt_rand(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee?->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

}
