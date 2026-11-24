<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Removes a project's environment with the UI delete form's access.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EnvironmentDeleteToolTest extends BakersToolTestBase {

  use EnvironmentToolTrait;
  use ForeignWorkspaceTrait;

  /**
   * A lead removes it; tickets lose only that reference.
   */
  public function testLeadDeletesEnvironment(): void {
    $prod = $this->environment('prod', 'main');
    $staging = $this->environment('staging', 'develop');
    $ticket = $this->ticket('TOOLPROJEC-7', ['environments' => [$staging->id(), $prod->id()]]);
    $this->actAsLead();
    $out = $this->outputs($this->runTool('bakers_environment_delete', [
      'project' => 'TOOLPROJEC',
      'environment' => 'staging',
    ]));
    self::assertSame(['uuid' => $staging->uuid(), 'name' => 'staging'], $out);
    self::assertSame([
      ['name' => 'prod', 'branch' => 'main', 'base_url' => 'https://prod.example.test'],
    ], $this->readEnvironments());
    $stored = $this->reload($ticket);
    self::assertSame('TOOLPROJEC-7', $stored->label());
    self::assertSame([(string) $prod->id()], array_map('strval', array_column($stored->get('environments')->getValue(), 'target_id')));
  }

  /**
   * A lead removes by UUID.
   */
  public function testLeadDeletesByUuid(): void {
    $prod = $this->environment('prod', 'main');
    $this->actAsLead();
    $this->outputs($this->runTool('bakers_environment_delete', [
      'project' => 'TOOLPROJEC',
      'environment' => $prod->uuid(),
    ]));
    self::assertSame(0, $this->environmentCount());
  }

  /**
   * A contributor sees but may not remove it; a guest does not see it.
   */
  public function testRefusesWithoutRight(): void {
    $this->environment('prod', 'main');
    $input = ['project' => 'TOOLPROJEC', 'environment' => 'prod'];
    $this->assertFailure($this->runTool('bakers_environment_delete', $input), 'You may not remove environment prod of project TOOLPROJEC');
    $this->actAsGuest();
    $this->assertFailure($this->runTool('bakers_environment_delete', $input), 'Environment prod is not one of project TOOLPROJEC’s environments.');
    self::assertSame(1, $this->environmentCount());
  }

  /**
   * A lead of another workspace is refused; nothing changes.
   */
  public function testRefusesForeignLead(): void {
    $this->environment('prod', 'main');
    $this->actAsForeignLead();
    $this->assertFailure($this->runTool('bakers_environment_delete', [
      'project' => 'TOOLPROJEC',
      'environment' => 'prod',
    ]), 'TOOLPROJEC');
    self::assertSame(1, $this->environmentCount());
  }

  /**
   * The tool is destructive and its inputs are an explicit allowlist.
   */
  public function testDefinition(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_environment_delete');
    self::assertTrue($definition->isDestructive());
    self::assertSame(['project', 'environment'], array_keys($definition->getInputDefinitions()));
  }

}
