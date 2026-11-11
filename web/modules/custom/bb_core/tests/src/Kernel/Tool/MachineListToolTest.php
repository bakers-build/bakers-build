<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists the machines the caller may view, with how to reach them.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_machine');
  }

  /**
   * Own machines only, by name, with a null URL when unset, paged.
   */
  public function testListsViewableMachines(): void {
    $box_a = $this->machine($this->actor, 'box-a', 'ssh://cw@box-a.example', 3);
    $box_b = $this->machine($this->actor, 'box-b');
    $this->machine($this->account('stranger'), 'box-x', 'ssh://x@box-x.example');
    self::assertSame([
      'machines' => [
        $this->row($box_a, 'ssh://cw@box-a.example', 3),
        $this->row($box_b, NULL, 5),
      ],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_machine_list', [])));

    $first = $this->outputs($this->runTool('bakers_machine_list', ['limit' => 1]));
    self::assertSame([$this->row($box_a, 'ssh://cw@box-a.example', 3)], $first['machines']);
    self::assertSame(1, $first['next_offset']);
  }

  /**
   * The conductor filter keeps only that conductor's machine.
   */
  public function testFiltersByConductor(): void {
    $this->machine($this->actor, 'box-a');
    $box_b = $this->machine($this->actor, 'box-b');
    $on_b = $this->conductor('on-b', $this->actor, $box_b);
    $bare = $this->conductor('bare', $this->actor);
    self::assertSame(['box-b'], $this->machineIds(['conductor' => $on_b->uuid()]));
    self::assertSame([], $this->machineIds(['conductor' => $bare->uuid()]));
    $this->assertFailure(
      $this->runTool('bakers_machine_list', ['conductor' => '00000000-0000-4000-8000-000000000000']),
      'Conductor 00000000-0000-4000-8000-000000000000 does not exist or is not readable.',
    );
  }

  /**
   * The workspace filter keeps machines with a conductor in that workspace.
   */
  public function testFiltersByWorkspace(): void {
    $box_a = $this->machine($this->actor, 'box-a');
    $box_b = $this->machine($this->actor, 'box-b');
    $this->conductor('here', $this->actor, $box_a);
    $other = $this->entity('bb_workspace', ['name' => 'other', 'slug' => 'other']);
    $this->addMembership($other, $this->actor, ['contributor']);
    $group = $this->entity('bb_group', ['name' => 'other-group', 'workspace_id' => $other->id()]);
    $there = $this->entity('bb_project', [
      'name' => 'other-project',
      'group_id' => $group->id(),
      'teams' => $this->project->get('teams')->getValue(),
    ]);
    $this->conductor('there', $this->actor, $box_b, $there);
    self::assertSame(['box-a'], $this->machineIds(['workspace' => $this->workspace->uuid()]));
    self::assertSame(['box-b'], $this->machineIds(['workspace' => $other->uuid()]));

    [$foreign] = $this->foreignWorkspace();
    $this->container->get('current_user')->setAccount($this->actor);
    $this->assertFailure($this->runTool('bakers_machine_list', ['workspace' => $foreign->uuid()]), 'does not exist or is not readable');
  }

  /**
   * A teammate's machine stays hidden, also under its conductor's filter.
   */
  public function testHidesUnviewableMachine(): void {
    $teammate = $this->account('teammate', ['skill_user']);
    $this->addMembership($this->workspace, $teammate, ['contributor']);
    $team = $this->project->get('teams')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $team);
    $this->addMembership($team, $teammate);
    $box_t = $this->machine($teammate, 'box-t', 'ssh://t@box-t.example');
    $on_t = $this->conductor('on-t', $teammate, $box_t);

    self::assertSame([], $this->machineIds([]));
    self::assertSame([], $this->machineIds(['conductor' => $on_t->uuid()]));
    self::assertSame([], $this->machineIds(['workspace' => $this->workspace->uuid()]));

    $this->container->get('current_user')->setAccount($teammate);
    self::assertSame(
      [$this->row($box_t, 'ssh://t@box-t.example', 5)],
      $this->outputs($this->runTool('bakers_machine_list', ['conductor' => $on_t->uuid()]))['machines'],
    );
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_machine_list');
    self::assertSame(['workspace', 'conductor', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
  }

  /**
   * The machine_ids the tool lists for the given inputs.
   *
   * @param array<string, mixed> $values
   *   The tool inputs.
   *
   * @return array<string>
   *   The listed machine_ids.
   */
  private function machineIds(array $values): array {
    return array_column($this->outputs($this->runTool('bakers_machine_list', $values))['machines'], 'machine_id');
  }

  /**
   * The expected row of a machine.
   *
   * @return array<string, mixed>
   *   The row.
   */
  private function row(ContentEntityInterface $machine, ?string $url, int $max_parallel): array {
    return [
      'uuid' => $machine->uuid(),
      'machine_id' => $machine->get('host_key')->value,
      'label' => $machine->label(),
      'connection_url' => $url,
      'max_parallel' => $max_parallel,
      'current_load' => 0,
    ];
  }

  /**
   * A machine of the owner.
   */
  private function machine(UserInterface $owner, string $host_key, ?string $url = NULL, ?int $max_parallel = NULL): ContentEntityInterface {
    return $this->entity('bb_machine', array_filter([
      'name' => $host_key,
      'host_key' => $host_key,
      'owner_user_id' => $owner->id(),
      'connection_url' => $url,
      'max_parallel' => $max_parallel,
    ], static fn ($value) => $value !== NULL));
  }

  /**
   * A conductor of the owner on the machine, for a project.
   */
  private function conductor(string $label, UserInterface $owner, ?ContentEntityInterface $machine = NULL, ?ContentEntityInterface $project = NULL): ContentEntityInterface {
    return $this->entity('bb_conductor', [
      'conductor_id' => $this->randomMachineName(),
      'label' => $label,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => ($project ?? $this->project)->id(),
      'machine' => $machine?->id(),
    ]);
  }

}
