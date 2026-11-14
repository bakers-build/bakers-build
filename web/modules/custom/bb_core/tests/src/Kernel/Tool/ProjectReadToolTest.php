<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Reads one project by key or UUID, never its environment variables.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectReadToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_environment');
    user_role_grant_permissions('skill_user', ['view bb_environment']);
  }

  /**
   * Key and UUID read the same values; env_vars stays out.
   */
  public function testReadsByKeyOrUuid(): void {
    $this->project->set('description', ['value' => 'About it', 'format' => 'bb_rich']);
    $this->project->set('repository', ['url' => 'https://git.example.com/a/b.git', 'default_branch' => 'develop']);
    $this->project->set('coder_config', ['image' => 'php:8.4']);
    $this->project->set('env_vars', 'SECRET=hunter2');
    $this->project->save();
    $expected = [
      'uuid' => $this->project->uuid(),
      'key' => 'TOOLPROJEC',
      'name' => 'tool-project',
      'description' => 'About it',
      'group' => $this->project->get('group_id')->entity->uuid(),
      'teams' => [$this->project->get('teams')->entity->uuid()],
      'repository' => [
        'url' => 'https://git.example.com/a/b.git',
        'default_branch' => 'develop',
        'branch_convention' => NULL,
      ],
      'coder_config' => ['image' => 'php:8.4'],
      'environments' => [],
    ];
    self::assertSame($expected, $this->outputs($this->runTool('bakers_project_read', ['project' => 'TOOLPROJEC'])));
    $by_uuid = $this->outputs($this->runTool('bakers_project_read', ['project' => $this->project->uuid()]));
    self::assertSame($expected, $by_uuid);
    self::assertStringNotContainsString('hunter2', serialize($by_uuid));
  }

  /**
   * The project's environments are listed by name; another project's are not.
   */
  public function testListsProjectEnvironments(): void {
    $this->entity('bb_environment', [
      'name' => 'prod',
      'project_id' => $this->project->id(),
      'branch' => 'main',
      'base_url' => 'https://bakers.example.com',
    ]);
    $this->entity('bb_environment', ['name' => 'develop', 'project_id' => $this->project->id(), 'branch' => 'next']);
    $other = $this->entity('bb_project', [
      'name' => 'other-project',
      'group_id' => $this->project->get('group_id')->target_id,
    ]);
    $this->entity('bb_environment', ['name' => 'foreign', 'project_id' => $other->id(), 'branch' => 'main']);
    $out = $this->outputs($this->runTool('bakers_project_read', ['project' => 'TOOLPROJEC']));
    self::assertSame([
      ['name' => 'develop', 'branch' => 'next', 'base_url' => NULL],
      ['name' => 'prod', 'branch' => 'main', 'base_url' => 'https://bakers.example.com'],
    ], $out['environments']);
  }

  /**
   * An empty repository and coder config read as NULL.
   */
  public function testEmptyValuesAreNull(): void {
    $out = $this->outputs($this->runTool('bakers_project_read', ['project' => 'TOOLPROJEC']));
    self::assertNull($out['description']);
    self::assertNull($out['repository']);
    self::assertNull($out['coder_config']);
  }

  /**
   * A foreign contributor cannot read the project; neither can an unknown key.
   */
  public function testRefusesUnreadable(): void {
    $this->assertFailure($this->runTool('bakers_project_read', ['project' => 'NOPE']), 'Project NOPE does not exist or is not readable.');
    [, $stranger] = $this->foreignWorkspace();
    $this->container->get('current_user')->setAccount($stranger);
    $this->assertFailure($this->runTool('bakers_project_read', ['project' => 'TOOLPROJEC']), 'does not exist or is not readable');
    $this->assertFailure($this->runTool('bakers_project_read', ['project' => $this->project->uuid()]), 'does not exist or is not readable');
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_project_read');
    self::assertSame(['project'], array_keys($definition->getInputDefinitions()));
  }

}
