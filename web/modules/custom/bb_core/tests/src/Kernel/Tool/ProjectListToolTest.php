<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists the readable projects, optionally by workspace, group and name.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Filters narrow the readable projects; rows carry the group UUID.
   */
  public function testListsAndFilters(): void {
    $group = $this->project->get('group_id')->entity;
    $second = $this->entity('bb_project', [
      'name' => 'alpha-project',
      'group_id' => $group->id(),
      'teams' => $this->project->get('teams')->getValue(),
    ]);
    $row = static fn ($project): array => [
      'uuid' => $project->uuid(),
      'key' => $project->get('key')->value,
      'name' => $project->label(),
      'group' => $group->uuid(),
    ];
    self::assertSame([
      'projects' => [$row($second), $row($this->project)],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_project_list', [])));

    $filtered = $this->outputs($this->runTool('bakers_project_list', [
      'workspace' => $this->workspace->uuid(),
      'group' => $group->uuid(),
      'query' => 'tool',
    ]));
    self::assertSame([$row($this->project)], $filtered['projects']);

    $unknown = '00000000-0000-4000-8000-000000000000';
    $this->assertFailure($this->runTool('bakers_project_list', ['workspace' => $unknown]), $unknown);
    $this->assertFailure($this->runTool('bakers_project_list', ['group' => $unknown]), $unknown);
  }

  /**
   * A foreign contributor neither sees nor filters by another tenant's rows.
   */
  public function testNoCrossWorkspaceLeak(): void {
    [, $stranger] = $this->foreignWorkspace();
    $this->container->get('current_user')->setAccount($stranger);
    self::assertSame([], $this->outputs($this->runTool('bakers_project_list', []))['projects']);
    $this->assertFailure(
      $this->runTool('bakers_project_list', ['workspace' => $this->workspace->uuid()]),
      'does not exist or is not readable',
    );
  }

  /**
   * Pages by name with limit and offset.
   */
  public function testPages(): void {
    $this->entity('bb_project', [
      'name' => 'z-project',
      'group_id' => $this->project->get('group_id')->target_id,
      'teams' => $this->project->get('teams')->getValue(),
    ]);
    $first = $this->outputs($this->runTool('bakers_project_list', ['limit' => 1]));
    self::assertSame('tool-project', $first['projects'][0]['name']);
    self::assertSame(1, $first['next_offset']);
    $next = $this->outputs($this->runTool('bakers_project_list', ['limit' => 1, 'offset' => 1]));
    self::assertSame('z-project', $next['projects'][0]['name']);
    self::assertNull($next['next_offset']);
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_project_list');
    self::assertSame(['workspace', 'group', 'query', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
  }

}
