<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Creates a project's environment with the UI add form's access.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EnvironmentCreateToolTest extends BakersToolTestBase {

  use EnvironmentToolTrait;
  use ForeignWorkspaceTrait;

  /**
   * A workspace lead creates prod; the result and project read list it.
   */
  public function testLeadCreatesEnvironment(): void {
    $this->actAsLead();
    $out = $this->outputs($this->runTool('bakers_environment_create', [
      'project' => 'TOOLPROJEC',
      'name' => 'prod',
      'branch' => 'main',
      'base_url' => 'https://prod.example.test',
    ]));
    self::assertSame('prod', $out['name']);
    self::assertSame('main', $out['branch']);
    self::assertSame('https://prod.example.test', $out['base_url']);
    self::assertSame('TOOLPROJEC', $out['project']);
    self::assertNotEmpty($out['uuid']);
    self::assertSame([
      ['name' => 'prod', 'branch' => 'main', 'base_url' => 'https://prod.example.test'],
    ], $this->readEnvironments());
  }

  /**
   * A workspace contributor or guest may read the project, not create.
   */
  public function testRefusesWithoutRight(): void {
    $input = ['project' => 'TOOLPROJEC', 'name' => 'prod', 'branch' => 'main'];
    $this->assertFailure($this->runTool('bakers_environment_create', $input), 'You may not create environments of project TOOLPROJEC');
    $this->actAsGuest();
    $this->assertFailure($this->runTool('bakers_environment_create', $input), 'You may not create environments of project TOOLPROJEC');
    self::assertSame(0, $this->environmentCount());
  }

  /**
   * A lead of another workspace is refused on this project; nothing changes.
   */
  public function testRefusesForeignLead(): void {
    $this->actAsForeignLead();
    $this->assertFailure($this->runTool('bakers_environment_create', [
      'project' => 'TOOLPROJEC',
      'name' => 'prod',
      'branch' => 'main',
    ]), 'TOOLPROJEC');
    self::assertSame(0, $this->environmentCount());
  }

  /**
   * A name already used in the project is refused, as in the UI form.
   */
  public function testDuplicateNameRefused(): void {
    $this->actAsLead();
    $this->environment('prod', 'main');
    $this->assertFailure($this->runTool('bakers_environment_create', [
      'project' => 'TOOLPROJEC',
      'name' => 'prod',
      'branch' => 'release',
    ]), 'name');
    self::assertSame(1, $this->environmentCount());
  }

  /**
   * A created environment stamps a ship ticket with its branch.
   */
  public function testCreatedEnvironmentStampsDeploymentTicket(): void {
    $this->actAsLead();
    $ticket = $this->ticket('TOOLPROJEC-9', ['ticket_type' => $this->term('type', 'ship')->id()]);
    $this->outputs($this->runTool('bakers_environment_create', [
      'project' => 'TOOLPROJEC',
      'name' => 'prod',
      'branch' => 'main',
    ]));
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'environments_add' => ['prod'],
    ]));
    self::assertSame(['prod'], $out['environments']);
    self::assertSame('main', $this->reload($ticket)->get('target_branch')->value);
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_environment_create');
    self::assertSame(['project', 'name', 'branch', 'base_url'], array_keys($definition->getInputDefinitions()));
  }

}
