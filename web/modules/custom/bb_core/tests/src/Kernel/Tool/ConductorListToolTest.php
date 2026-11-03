<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists one readable project's conductors.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Only the project's conductors, by label.
   */
  public function testListsTheProjectsConductors(): void {
    $this->installEntitySchema('bb_machine');
    $machine = $this->entity('bb_machine', ['name' => 'cw-laptop', 'owner_user_id' => $this->actor->id()]);
    $online = $this->conductor('b-online', (int) $this->project->id(), 'online', TRUE, ['machine' => $machine->id()]);
    $offline = $this->conductor('a-offline', (int) $this->project->id(), 'offline', FALSE, ['variant' => 'shop']);
    $other = $this->entity('bb_project', [
      'name' => 'other-project',
      'group_id' => $this->project->get('group_id')->target_id,
      'teams' => $this->project->get('teams')->getValue(),
    ]);
    $this->conductor('c-elsewhere', (int) $other->id(), 'online');
    $row = static fn (ContentEntityInterface $conductor, string $variant, ?string $machine, bool $active, string $status): array => [
      'uuid' => $conductor->uuid(),
      'label' => $conductor->label(),
      'variant' => $variant,
      'machine' => $machine,
      'active' => $active,
      'status' => $status,
    ];
    self::assertSame([
      'conductors' => [
        $row($offline, 'shop', NULL, FALSE, 'offline'),
        $row($online, 'conductor', 'cw-laptop', TRUE, 'online'),
      ],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_conductor_list', ['project' => 'TOOLPROJEC'])));

    $first = $this->outputs($this->runTool('bakers_conductor_list', ['project' => $this->project->uuid(), 'limit' => 1]));
    self::assertSame([$row($offline, 'shop', NULL, FALSE, 'offline')], $first['conductors']);
    self::assertSame(1, $first['next_offset']);
  }

  /**
   * A foreign contributor cannot name the project.
   */
  public function testRefusesForeignProject(): void {
    $this->conductor('secret', (int) $this->project->id(), 'online');
    [, $stranger] = $this->foreignWorkspace();
    $this->container->get('current_user')->setAccount($stranger);
    $this->assertFailure($this->runTool('bakers_conductor_list', ['project' => 'TOOLPROJEC']), 'does not exist or is not readable');
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_conductor_list');
    self::assertSame(['project', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
  }

  /**
   * A conductor of the given project owned by the actor.
   *
   * @param string $label
   *   The label.
   * @param int $project_id
   *   The project id.
   * @param string $status
   *   The status.
   * @param bool $active
   *   Whether it is active.
   * @param array<string, mixed> $values
   *   Further field values.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function conductor(string $label, int $project_id, string $status, bool $active = TRUE, array $values = []): ContentEntityInterface {
    return $this->entity('bb_conductor', $values + [
      'label' => $label,
      'owner_user_id' => $this->actor->id(),
      'active' => $active,
      'status' => $status,
      'project_id' => $project_id,
    ]);
  }

}
