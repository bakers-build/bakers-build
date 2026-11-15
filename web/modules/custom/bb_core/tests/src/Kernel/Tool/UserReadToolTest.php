<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Reads you or a visible user: profile, teams, machines and conductors.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class UserReadToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * The team the actor sits on, placed in the workspace.
   */
  private ContentEntityInterface $team;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_machine');
    $team = $this->project->get('teams')->entity;
    assert($team instanceof ContentEntityInterface);
    $team->set('workspace_id', $this->workspace->id())->save();
    $this->team = $team;
    $this->actor->set('mail', 'actor@example.com')->save();
  }

  /**
   * Without input the caller reads itself in full; nothing is current.
   */
  public function testReadsSelfInFull(): void {
    $this->installProfileFields();
    $this->container->get('entity_type.manager')->getStorage('user')->loadUnchanged($this->actor->id())
      ->set('field_developer_title', 'Customer contact')
      ->set('field_bb_background', 'Talks with customers, who are not technical.')
      ->save();
    $box = $this->machine($this->actor, 'box-a', 'allow');
    $alpha = $this->conductor('alpha', $this->actor, $box);
    $beta = $this->conductor('beta', $this->actor, $box, 'forbid');
    $bare = $this->machine($this->actor, 'box-b');

    self::assertSame([
      'uuid' => $this->actor->uuid(),
      'name' => 'actor',
      'mail' => 'actor@example.com',
      'position' => 'Customer contact',
      'background' => 'Talks with customers, who are not technical.',
      'teams' => [
        [
          'uuid' => $this->team->uuid(),
          'label' => 'tool-team',
          'workspace' => $this->workspace->uuid(),
          'role' => 'contributor',
        ],
      ],
      'machines' => [
        $this->machineRow($box, 'allow', FALSE, [
          $this->conductorRow($alpha, 'machine', 'allow', FALSE),
          $this->conductorRow($beta, 'forbid', 'forbid', FALSE),
        ]),
        $this->machineRow($bare, 'forbid', FALSE, []),
      ],
    ], $this->outputs($this->runTool('bakers_user_read', [])));
  }

  /**
   * The caller's own conductor_id marks that conductor and its machine.
   */
  public function testMarksCurrentConductor(): void {
    $box = $this->machine($this->actor, 'box-a');
    $alpha = $this->conductor('alpha', $this->actor, $box);
    $beta = $this->conductor('beta', $this->actor, $box);
    $other = $this->machine($this->actor, 'box-b');

    $machines = $this->outputs($this->runTool('bakers_user_read', ['conductor' => $beta->get('conductor_id')->value]))['machines'];
    self::assertSame([
      $this->machineRow($box, 'forbid', TRUE, [
        $this->conductorRow($alpha, 'machine', 'forbid', FALSE),
        $this->conductorRow($beta, 'machine', 'forbid', TRUE),
      ]),
      $this->machineRow($other, 'forbid', FALSE, []),
    ], $machines);
  }

  /**
   * A conductor_id that is not the caller's marks nothing, on any user.
   */
  public function testForeignConductorIdMarksNothing(): void {
    $teammate = $this->teammate();
    $on_t = $this->conductor('on-t', $teammate, $this->machine($teammate, 'box-t'));
    $this->conductor('alpha', $this->actor, $this->machine($this->actor, 'box-a'));
    $foreign = (string) $on_t->get('conductor_id')->value;

    $self = $this->outputs($this->runTool('bakers_user_read', ['conductor' => $foreign]));
    $other = $this->outputs($this->runTool('bakers_user_read', ['user' => 'teammate', 'conductor' => $foreign]));
    foreach ([$self, $other] as $read) {
      self::assertCount(1, $read['machines']);
      self::assertFalse($read['machines'][0]['current']);
      self::assertFalse($read['machines'][0]['conductors'][0]['current']);
    }
  }

  /**
   * A teammate reads the same by mail, in any case, and by username.
   *
   * Their mail stays hidden, and only machines carrying a conductor the
   * caller can view are listed.
   */
  public function testReadsTeammateByMailOrUsername(): void {
    $teammate = $this->teammate();
    $box = $this->machine($teammate, 'box-t', 'allow');
    $on_t = $this->conductor('on-t', $teammate, $box);
    $this->machine($teammate, 'box-hidden');

    $by_mail = $this->outputs($this->runTool('bakers_user_read', ['user' => 'TeamMate@Example.com']));
    self::assertSame($by_mail, $this->outputs($this->runTool('bakers_user_read', ['user' => 'teammate'])));
    self::assertSame([
      'uuid' => $teammate->uuid(),
      'name' => 'teammate',
      'mail' => NULL,
      'position' => '',
      'background' => '',
      'teams' => [
        [
          'uuid' => $this->team->uuid(),
          'label' => 'tool-team',
          'workspace' => $this->workspace->uuid(),
          'role' => 'lead',
        ],
      ],
      'machines' => [
        $this->machineRow($box, 'allow', FALSE, [$this->conductorRow($on_t, 'machine', 'allow', FALSE)]),
      ],
    ], $by_mail);
  }

  /**
   * Unknown, blocked and invisible users get one identical refusal.
   */
  public function testRefusesUnseenUsersAlike(): void {
    $blocked = $this->teammate();
    $blocked->block()->save();
    [, $stranger] = $this->foreignWorkspace();
    $stranger->set('mail', 'stranger@example.com')->save();
    $this->container->get('current_user')->setAccount($this->actor);

    $messages = [];
    foreach (['nobody', 'nobody@example.com', 'teammate', 'stranger', 'stranger@example.com'] as $user) {
      $result = $this->runTool('bakers_user_read', ['user' => $user]);
      self::assertFalse($result->isSuccess(), $user);
      $messages[] = (string) $result->getMessage();
    }
    self::assertSame(['Invalid input: No such user is visible to you.'], array_values(array_unique($messages)));
  }

  /**
   * An anonymous caller is refused.
   */
  public function testRefusesAnonymous(): void {
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $this->assertFailure($this->runTool('bakers_user_read', []), 'signed-in');
    $this->assertFailure($this->runTool('bakers_user_read', ['user' => 'actor']), 'signed-in');
  }

  /**
   * The inputs are an explicit allowlist.
   */
  public function testInputAllowlist(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_user_read');
    self::assertSame(['user', 'conductor'], array_keys($definition->getInputDefinitions()));
  }

  /**
   * A lead of the workspace on the actor's team.
   */
  private function teammate(): UserInterface {
    $teammate = $this->account('teammate', ['skill_user']);
    $teammate->set('mail', 'teammate@example.com')->save();
    $this->addMembership($this->workspace, $teammate, ['lead']);
    $this->addMembership($this->team, $teammate);
    // The actor's scope is memoised per request; a real request starts fresh.
    $this->container->get('bb_core.workspace_read_scope')->reset();
    return $teammate;
  }

  /**
   * A machine of the owner.
   */
  private function machine(UserInterface $owner, string $host_key, string $assignment = 'forbid'): ContentEntityInterface {
    return $this->entity('bb_machine', [
      'name' => $host_key,
      'host_key' => $host_key,
      'owner_user_id' => $owner->id(),
      'assignment' => $assignment,
    ]);
  }

  /**
   * A conductor of the owner on the machine, in the actor's project.
   */
  private function conductor(string $label, UserInterface $owner, ContentEntityInterface $machine, string $assignment = 'machine'): ContentEntityInterface {
    return $this->entity('bb_conductor', [
      'conductor_id' => $this->randomMachineName(),
      'label' => $label,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $this->project->id(),
      'machine' => $machine->id(),
      'assignment' => $assignment,
    ]);
  }

  /**
   * The expected row of a machine.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $machine
   *   The machine.
   * @param string $assignment
   *   The machine's assignment.
   * @param bool $current
   *   Whether it is current.
   * @param array<array<string, mixed>> $conductors
   *   The expected conductor rows.
   *
   * @return array<string, mixed>
   *   The row.
   */
  private function machineRow(ContentEntityInterface $machine, string $assignment, bool $current, array $conductors): array {
    return [
      'uuid' => $machine->uuid(),
      'machine_id' => $machine->get('host_key')->value,
      'name' => $machine->label(),
      'max_parallel' => 5,
      'current_load' => 0,
      'assignment' => $assignment,
      'current' => $current,
      'conductors' => $conductors,
    ];
  }

  /**
   * The expected row of a conductor.
   *
   * @return array<string, mixed>
   *   The row.
   */
  private function conductorRow(ContentEntityInterface $conductor, string $setting, string $assignment, bool $current): array {
    return [
      'uuid' => $conductor->uuid(),
      'conductor_id' => $conductor->get('conductor_id')->value,
      'label' => $conductor->get('label')->value,
      'project' => $this->project->uuid(),
      'status' => 'online',
      'assignment_setting' => $setting,
      'assignment' => $assignment,
      'current' => $current,
    ];
  }

  /**
   * Installs the two profile fields from config/sync, where they live.
   */
  private function installProfileFields(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    foreach (['field_developer_title', 'field_bb_background'] as $name) {
      $storageData = $storage->read("field.storage.user.$name");
      self::assertIsArray($storageData);
      FieldStorageConfig::create($storageData)->save();
      $fieldData = $storage->read("field.field.user.user.$name");
      self::assertIsArray($fieldData);
      FieldConfig::create($fieldData)->save();
    }
  }

}
