<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\tool\FormattedToolResultInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Creates a project in a group for teams of the same workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectCreateToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * A team of the actor's workspace the actor belongs to.
   */
  private ContentEntityInterface $team;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->team = $this->entity('bb_team', ['name' => 'create-team', 'workspace_id' => $this->workspace->id()]);
    $this->addMembership($this->team, $this->actor);
  }

  /**
   * The key derives from the name; the output matches the stored project.
   */
  public function testCreatesProject(): void {
    $group = $this->project->get('group_id')->entity;
    $out = $this->outputs($this->runTool('bakers_project_create', [
      'group' => $group->uuid(),
      'name' => 'New Project',
      'teams' => [$this->team->uuid()],
      'description' => 'Fresh',
      'repository' => ['url' => 'git@git.example.com:a/b.git', 'default_branch' => 'main'],
      'coder_config' => ['image' => 'php:8.4'],
    ]));
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_project')->loadByProperties(['uuid' => $out['uuid']]);
    $stored = reset($stored);
    self::assertInstanceOf(ContentEntityInterface::class, $stored);
    self::assertSame([
      'uuid' => $stored->uuid(),
      'key' => 'NEWPROJECT',
      'name' => 'New Project',
      'description' => 'Fresh',
      'group' => $group->uuid(),
      'teams' => [$this->team->uuid()],
      'repository' => ['url' => 'git@git.example.com:a/b.git', 'default_branch' => 'main', 'branch_convention' => NULL],
      'coder_config' => ['image' => 'php:8.4'],
    ], $out);
    self::assertSame((string) $this->actor->id(), (string) $stored->get('owner_user_id')->target_id);
    self::assertSame('1', (string) $stored->get('next_number')->value);
  }

  /**
   * A team of another workspace is refused even when the actor belongs to it.
   */
  public function testRefusesTeamOfAnotherWorkspace(): void {
    [$foreign] = $this->foreignWorkspace();
    $team = $this->entity('bb_team', ['name' => 'foreign-team', 'workspace_id' => $foreign->id()]);
    $this->addMembership($foreign, $this->actor, ['contributor']);
    $this->addMembership($team, $this->actor);
    $this->container->get('current_user')->setAccount($this->actor);

    $this->assertFailure($this->create(['teams' => [$this->team->uuid(), $team->uuid()]]), 'is not in the group’s workspace');
    $this->assertNothingSaved();
  }

  /**
   * An outsider, empty teams and an invalid repository save nothing.
   */
  public function testRefusalsSaveNothing(): void {
    $this->assertFailure($this->create(['repository' => ['url' => 'not a url']]), 'repository');
    $this->assertFailure($this->create(['teams' => []]), 'team');
    $unknown = '00000000-0000-4000-8000-000000000000';
    $this->assertFailure($this->create(['teams' => [$unknown]]), $unknown);
    $this->assertNothingSaved();

    [, $stranger] = $this->foreignWorkspace();
    $this->container->get('current_user')->setAccount($stranger);
    $this->assertFailure($this->create([]), 'does not exist or is not readable');
    $this->assertNothingSaved();
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_project_create');
    self::assertSame(
      ['group', 'name', 'teams', 'description', 'repository', 'coder_config'],
      array_keys($definition->getInputDefinitions()),
    );
  }

  /**
   * Runs the create tool with valid defaults overridden by the given values.
   *
   * @param array<string, mixed> $values
   *   Input overrides.
   */
  private function create(array $values): FormattedToolResultInterface {
    return $this->runTool('bakers_project_create', $values + [
      'group' => $this->project->get('group_id')->entity->uuid(),
      'name' => 'Refused',
      'teams' => [$this->team->uuid()],
    ]);
  }

  /**
   * Only the fixture project exists.
   */
  private function assertNothingSaved(): void {
    $ids = $this->container->get('entity_type.manager')->getStorage('bb_project')->getQuery()->accessCheck(FALSE)->execute();
    self::assertSame([(int) $this->project->id()], array_map('intval', array_values($ids)));
  }

}
