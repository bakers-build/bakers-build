<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists the workspaces the account can view, without a chosen workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Each account sees only its own workspaces.
   */
  public function testListsOnlyViewableWorkspaces(): void {
    [$foreign] = $this->foreignWorkspace();
    self::assertSame([
      'workspaces' => [['uuid' => $foreign->uuid(), 'name' => 'foreign', 'slug' => 'foreign']],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_workspace_list', [])));

    $this->container->get('current_user')->setAccount($this->actor);
    self::assertSame([
      'workspaces' => [['uuid' => $this->workspace->uuid(), 'name' => 'tool-workspace', 'slug' => 'tool-workspace']],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_workspace_list', [])));
  }

  /**
   * Pages by name with limit and offset.
   */
  public function testPages(): void {
    $second = $this->entity('bb_workspace', ['name' => 'z-second', 'slug' => 'z-second']);
    $this->addMembership($second, $this->actor, ['guest']);
    $first = $this->outputs($this->runTool('bakers_workspace_list', ['limit' => 1]));
    self::assertSame('tool-workspace', $first['workspaces'][0]['name']);
    self::assertSame(1, $first['next_offset']);
    $next = $this->outputs($this->runTool('bakers_workspace_list', ['limit' => 1, 'offset' => 1]));
    self::assertSame('z-second', $next['workspaces'][0]['name']);
    self::assertNull($next['next_offset']);
    $this->assertFailure($this->runTool('bakers_workspace_list', ['limit' => 101]), 'limit must be');
  }

  /**
   * The tool takes paging only.
   */
  public function testInputsArePagingOnly(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_workspace_list');
    self::assertSame(['limit', 'offset'], array_keys($definition->getInputDefinitions()));
  }

}
