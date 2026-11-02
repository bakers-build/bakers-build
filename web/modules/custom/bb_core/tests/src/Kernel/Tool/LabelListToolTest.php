<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists the labels of one viewable workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class LabelListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Lists label terms only, by name, optionally matching a query.
   */
  public function testListsLabelsOfTheWorkspace(): void {
    $backend = $this->term('label', 'backend');
    $frontend = $this->term('label', 'frontend');
    $this->term('label', 'docs');
    $this->term('type', 'bug-end');
    $workspace = $this->workspace->uuid();

    $out = $this->outputs($this->runTool('bakers_label_list', ['workspace' => $workspace]));
    self::assertSame(['backend', 'docs', 'frontend'], array_column($out['labels'], 'name'));

    self::assertSame([
      'labels' => [
        ['uuid' => $backend->uuid(), 'name' => 'backend'],
        ['uuid' => $frontend->uuid(), 'name' => 'frontend'],
      ],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_label_list', ['workspace' => $workspace, 'query' => 'END'])));

    $page = $this->outputs($this->runTool('bakers_label_list', ['workspace' => $workspace, 'limit' => 2]));
    self::assertSame(['backend', 'docs'], array_column($page['labels'], 'name'));
    self::assertSame(2, $page['next_offset']);
  }

  /**
   * Another workspace's account is refused the workspace.
   */
  public function testForeignWorkspaceIsRefused(): void {
    $this->term('label', 'backend');
    [$foreign] = $this->foreignWorkspace();
    $this->entity('bb_term', ['vid' => 'label', 'name' => 'foreign-label', 'workspace_id' => $foreign->id()]);

    $uuid = $this->workspace->uuid();
    $this->assertFailure($this->runTool('bakers_label_list', ['workspace' => $uuid]), "Workspace $uuid does not exist or is not readable.");
    $out = $this->outputs($this->runTool('bakers_label_list', ['workspace' => $foreign->uuid()]));
    self::assertSame(['foreign-label'], array_column($out['labels'], 'name'));
  }

  /**
   * The tool takes the workspace, a query and paging only.
   */
  public function testInputs(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_label_list');
    self::assertSame(['workspace', 'query', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
  }

}
