<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists the groups of one viewable workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Lists the workspace's groups by name, or reads back one by UUID.
   */
  public function testListsGroupsOfTheWorkspace(): void {
    $group = $this->entity('bb_group', [
      'name' => 'a-group',
      'description' => 'Two lines' . "\n" . 'of text',
      'workspace_id' => $this->workspace->id(),
    ]);
    $workspace = $this->workspace->uuid();

    $out = $this->outputs($this->runTool('bakers_group_list', ['workspace' => $workspace]));
    self::assertSame(['a-group', 'tool-group'], array_column($out['groups'], 'name'));
    self::assertSame(['uuid' => $group->uuid(), 'name' => 'a-group', 'description' => "Two lines\nof text"], $out['groups'][0]);
    self::assertNull($out['groups'][1]['description']);
    self::assertNull($out['next_offset']);

    $one = $this->outputs($this->runTool('bakers_group_list', ['workspace' => $workspace, 'group' => $group->uuid()]));
    self::assertSame([$group->uuid()], array_column($one['groups'], 'uuid'));

    $page = $this->outputs($this->runTool('bakers_group_list', ['workspace' => $workspace, 'limit' => 1]));
    self::assertSame(['a-group'], array_column($page['groups'], 'name'));
    self::assertSame(1, $page['next_offset']);
  }

  /**
   * Another workspace's account is refused the workspace and its groups.
   */
  public function testForeignWorkspaceIsRefused(): void {
    $group = $this->entity('bb_group', ['name' => 'a-group', 'workspace_id' => $this->workspace->id()]);
    [$foreign] = $this->foreignWorkspace();
    $this->entity('bb_group', ['name' => 'foreign-group', 'workspace_id' => $foreign->id()]);

    $uuid = $this->workspace->uuid();
    $this->assertFailure($this->runTool('bakers_group_list', ['workspace' => $uuid]), "Workspace $uuid does not exist or is not readable.");
    // A group of another workspace is no match in the caller's own one.
    $values = ['workspace' => $foreign->uuid(), 'group' => $group->uuid()];
    $out = $this->outputs($this->runTool('bakers_group_list', $values));
    self::assertSame([], $out['groups']);
    $out = $this->outputs($this->runTool('bakers_group_list', ['workspace' => $foreign->uuid()]));
    self::assertSame(['foreign-group'], array_column($out['groups'], 'name'));
  }

  /**
   * The tool takes the workspace, one group and paging only.
   */
  public function testInputs(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_group_list');
    self::assertSame(['workspace', 'group', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
  }

}
