<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists the teams of one viewable workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TeamListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Lists the workspace's teams by name and pages them.
   */
  public function testListsTeamsOfTheWorkspace(): void {
    $alpha = $this->entity('bb_team', ['name' => 'alpha', 'workspace_id' => $this->workspace->id()]);
    $beta = $this->entity('bb_team', ['name' => 'beta', 'workspace_id' => $this->workspace->id()]);
    $workspace = $this->workspace->uuid();

    self::assertSame([
      'teams' => [['uuid' => $alpha->uuid(), 'name' => 'alpha'], ['uuid' => $beta->uuid(), 'name' => 'beta']],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_team_list', ['workspace' => $workspace])));

    $page = $this->outputs($this->runTool('bakers_team_list', ['workspace' => $workspace, 'limit' => 1, 'offset' => 1]));
    self::assertSame(['beta'], array_column($page['teams'], 'name'));
    self::assertNull($page['next_offset']);
  }

  /**
   * Another workspace's account is refused the workspace.
   */
  public function testForeignWorkspaceIsRefused(): void {
    $this->entity('bb_team', ['name' => 'alpha', 'workspace_id' => $this->workspace->id()]);
    [$foreign] = $this->foreignWorkspace();
    $this->entity('bb_team', ['name' => 'foreign-team', 'workspace_id' => $foreign->id()]);

    $uuid = $this->workspace->uuid();
    $this->assertFailure($this->runTool('bakers_team_list', ['workspace' => $uuid]), "Workspace $uuid does not exist or is not readable.");
    $out = $this->outputs($this->runTool('bakers_team_list', ['workspace' => $foreign->uuid()]));
    self::assertSame(['foreign-team'], array_column($out['teams'], 'name'));
  }

  /**
   * The tool takes the workspace and paging only.
   */
  public function testInputs(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_team_list');
    self::assertSame(['workspace', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
  }

}
