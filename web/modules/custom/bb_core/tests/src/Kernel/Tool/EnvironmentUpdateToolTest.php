<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Changes a project's environment with the UI edit form's access.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EnvironmentUpdateToolTest extends BakersToolTestBase {

  use EnvironmentToolTrait;
  use ForeignWorkspaceTrait;

  /**
   * A lead renames by name; branch and base URL stay.
   */
  public function testLeadUpdatesByName(): void {
    $this->environment('staging', 'develop');
    $this->actAsLead();
    $out = $this->outputs($this->runTool('bakers_environment_update', [
      'project' => 'TOOLPROJEC',
      'environment' => 'staging',
      'name' => 'stage',
    ]));
    $expected = ['name' => 'stage', 'branch' => 'develop', 'base_url' => 'https://staging.example.test'];
    self::assertSame($expected, array_intersect_key($out, $expected));
    self::assertSame([$expected], $this->readEnvironments());
  }

  /**
   * A lead changes branch and base URL by UUID; the name stays.
   */
  public function testLeadUpdatesByUuid(): void {
    $environment = $this->environment('prod', 'master');
    $this->actAsLead();
    $out = $this->outputs($this->runTool('bakers_environment_update', [
      'project' => 'TOOLPROJEC',
      'environment' => $environment->uuid(),
      'branch' => 'main',
      'base_url' => 'https://www.example.test',
    ]));
    $expected = ['name' => 'prod', 'branch' => 'main', 'base_url' => 'https://www.example.test'];
    self::assertSame($expected, array_intersect_key($out, $expected));
    self::assertSame($environment->uuid(), $out['uuid']);
    self::assertSame([$expected], $this->readEnvironments());
  }

  /**
   * Unknown names and another project's environment are refused by name.
   */
  public function testUnknownEnvironmentIsRefused(): void {
    $other = $this->entity('bb_project', [
      'name' => 'other-project',
      'group_id' => $this->project->get('group_id')->target_id,
    ]);
    $foreign = $this->environment('elsewhere', 'main', (int) $other->id());
    $this->actAsLead();
    foreach (['nowhere', 'elsewhere', $foreign->uuid()] as $value) {
      $this->assertFailure($this->runTool('bakers_environment_update', [
        'project' => 'TOOLPROJEC',
        'environment' => $value,
        'branch' => 'x',
      ]), "Environment $value is not one of project TOOLPROJEC’s environments.");
    }
    self::assertSame('main', $this->reloadEnvironment($foreign->id())->get('branch')->value);
  }

  /**
   * A rename onto a name used in the project is refused.
   */
  public function testDuplicateNameRefused(): void {
    $this->environment('prod', 'main');
    $staging = $this->environment('staging', 'develop');
    $this->actAsLead();
    $this->assertFailure($this->runTool('bakers_environment_update', [
      'project' => 'TOOLPROJEC',
      'environment' => 'staging',
      'name' => 'prod',
    ]), 'name');
    self::assertSame('staging', $this->reloadEnvironment($staging->id())->label());
  }

  /**
   * A contributor sees but may not change it; a guest does not see it.
   */
  public function testRefusesWithoutRight(): void {
    $environment = $this->environment('prod', 'main');
    $input = ['project' => 'TOOLPROJEC', 'environment' => 'prod', 'branch' => 'develop'];
    $this->assertFailure($this->runTool('bakers_environment_update', $input), 'You may not change environment prod of project TOOLPROJEC');
    $this->actAsGuest();
    $this->assertFailure($this->runTool('bakers_environment_update', $input), 'Environment prod is not one of project TOOLPROJEC’s environments.');
    self::assertSame('main', $this->reloadEnvironment($environment->id())->get('branch')->value);
  }

  /**
   * A lead of another workspace is refused; nothing changes.
   */
  public function testRefusesForeignLead(): void {
    $environment = $this->environment('prod', 'main');
    $this->actAsForeignLead();
    $this->assertFailure($this->runTool('bakers_environment_update', [
      'project' => 'TOOLPROJEC',
      'environment' => 'prod',
      'branch' => 'develop',
    ]), 'TOOLPROJEC');
    self::assertSame('main', $this->reloadEnvironment($environment->id())->get('branch')->value);
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_environment_update');
    self::assertSame(['project', 'environment', 'name', 'branch', 'base_url'], array_keys($definition->getInputDefinitions()));
  }

}
