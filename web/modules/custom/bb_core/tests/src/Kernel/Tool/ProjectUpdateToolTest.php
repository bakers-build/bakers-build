<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Changes a project's repository settings under `edit bb_project`.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectUpdateToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Project validation reads the project's environments.
    $this->installEntitySchema('bb_environment');
    // Validation re-checks the stored teams; real teams carry a workspace.
    $team = $this->project->get('teams')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $team);
    $team->set('workspace_id', $this->workspace->id())->save();
    $this->project->set('repository', [
      'url' => 'https://git.example.com/a/b.git',
      'default_branch' => 'main',
      'branch_convention' => 'feat/{key}',
    ]);
    $this->project->save();
  }

  /**
   * A workspace lead moves the default branch; other keys and tickets follow.
   */
  public function testLeadChangesDefaultBranch(): void {
    $this->actAsLead();
    $out = $this->outputs($this->runTool('bakers_project_update', [
      'project' => 'TOOLPROJEC',
      'repository' => ['default_branch' => 'develop'],
    ]));
    $expected = [
      'url' => 'https://git.example.com/a/b.git',
      'default_branch' => 'develop',
      'branch_convention' => 'feat/{key}',
    ];
    self::assertSame($expected, $out['repository']);
    self::assertSame($this->project->uuid(), $out['uuid']);
    $read = $this->outputs($this->runTool('bakers_project_read', ['project' => $this->project->uuid()]));
    self::assertSame($expected, $read['repository']);
    self::assertSame('develop', $this->ticket('TOOLPROJEC-1')->get('base_branch')->value);
  }

  /**
   * A team member without the right is told which right and who holds it.
   */
  public function testRefusesWithoutEditRight(): void {
    $result = $this->runTool('bakers_project_update', [
      'project' => 'TOOLPROJEC',
      'repository' => ['default_branch' => 'develop'],
    ]);
    $this->assertFailure($result, 'You may not edit project TOOLPROJEC: it needs edit bb_project, held by team leads, team owners and workspace leads of its workspace, or administer bakers.');
    $this->assertBranch('main');
  }

  /**
   * A lead of another workspace cannot even read the project.
   */
  public function testRefusesForeignLead(): void {
    $lead = $this->account('foreign-lead', ['skill_user']);
    $foreign = $this->entity('bb_workspace', ['name' => 'foreign', 'slug' => 'foreign', 'owner_user_id' => $lead->id()]);
    $this->addMembership($foreign, $lead, ['lead']);
    $this->container->get('current_user')->setAccount($lead);
    $this->assertFailure($this->runTool('bakers_project_update', [
      'project' => 'TOOLPROJEC',
      'repository' => ['default_branch' => 'develop'],
    ]), 'does not exist or is not readable');
    $this->assertBranch('main');
  }

  /**
   * An empty branch never falls back to main silently.
   */
  public function testRefusesBlankBranch(): void {
    $this->actAsLead();
    $this->assertFailure($this->runTool('bakers_project_update', [
      'project' => 'TOOLPROJEC',
      'repository' => ['default_branch' => ''],
    ]), 'default_branch');
    $this->assertBranch('main');
  }

  /**
   * A project without a repository needs a URL before a branch.
   */
  public function testNewRepositoryNeedsUrl(): void {
    $this->actAsLead();
    $this->project->set('repository', NULL)->save();
    $this->assertFailure($this->runTool('bakers_project_update', [
      'project' => 'TOOLPROJEC',
      'repository' => ['default_branch' => 'develop'],
    ]), 'url');
    $out = $this->outputs($this->runTool('bakers_project_update', [
      'project' => 'TOOLPROJEC',
      'repository' => ['url' => 'https://git.example.com/c/d.git', 'default_branch' => 'develop'],
    ]));
    self::assertSame('develop', $out['repository']['default_branch']);
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_project_update');
    self::assertSame(['project', 'repository'], array_keys($definition->getInputDefinitions()));
  }

  /**
   * Acts as a new lead of the project's workspace.
   *
   * A new account, because permissions are memoised per account once read.
   */
  private function actAsLead(): void {
    $lead = $this->account('lead', ['skill_user']);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->container->get('current_user')->setAccount($lead);
  }

  /**
   * The stored project's default branch.
   */
  private function assertBranch(string $branch): void {
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_project')->loadUnchanged($this->project->id());
    self::assertInstanceOf(ContentEntityInterface::class, $stored);
    self::assertSame($branch, $stored->get('repository')->first()?->getValue()['default_branch']);
  }

}
