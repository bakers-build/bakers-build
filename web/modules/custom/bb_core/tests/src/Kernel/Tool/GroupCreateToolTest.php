<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Creates a group in one workspace under the scoped create check.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupCreateToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * A contributor creates a group in the workspace; the actor owns it.
   */
  public function testCreatesGroup(): void {
    $out = $this->outputs($this->runTool('bakers_group_create', [
      'workspace' => $this->workspace->uuid(),
      'name' => 'Customer A',
      'description' => 'Cost centre',
    ]));
    self::assertSame(['Customer A', 'Cost centre'], [$out['name'], $out['description']]);
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_group')->loadByProperties(['uuid' => $out['uuid']]);
    $stored = reset($stored);
    self::assertInstanceOf(ContentEntityInterface::class, $stored);
    self::assertSame($this->workspace->id(), $stored->get('workspace_id')->target_id);
    self::assertSame($this->actor->id(), $stored->get('owner_user_id')->target_id);

    $values = ['workspace' => $this->workspace->uuid(), 'name' => 'Customer B'];
    $out = $this->outputs($this->runTool('bakers_group_create', $values));
    self::assertNull($out['description']);
  }

  /**
   * Another workspace's contributor is refused, also as a guest here.
   */
  public function testRefusesWithoutScopedCreateAccess(): void {
    [, $stranger] = $this->foreignWorkspace();
    $values = ['workspace' => $this->workspace->uuid(), 'name' => 'Nope'];
    $this->assertFailure($this->runTool('bakers_group_create', $values), 'does not exist or is not readable');

    // Its contributor rank elsewhere must not let a guest create here.
    $this->addMembership($this->workspace, $stranger, ['guest']);
    $this->assertFailure($this->runTool('bakers_group_create', $values), 'You may not create groups');
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_group')->loadByProperties(['name' => 'Nope']));
  }

  /**
   * An invalid group is not saved.
   */
  public function testValidationFailureSavesNothing(): void {
    $result = $this->runTool('bakers_group_create', [
      'workspace' => $this->workspace->uuid(),
      'name' => 'Too long',
      'description' => str_repeat('x', 281),
    ]);
    $this->assertFailure($result, 'description');
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_group')->loadByProperties(['name' => 'Too long']));
  }

  /**
   * The tool takes the workspace, name and description only.
   */
  public function testInputs(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_group_create');
    self::assertSame(['workspace', 'name', 'description'], array_keys($definition->getInputDefinitions()));
  }

}
