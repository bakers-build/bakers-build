<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies granular bb_project permissions via the custom access handler.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbProjectAccessTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_project');
    $this->installConfig(['user']);
    // Pre-create uid=1 so subsequent createUser() calls do not receive uid=1
    // (which bypasses all access checks in Drupal).
    $this->createUser();
  }

  /**
   * Verifies granular per-operation permissions for bb_project.
   *
   * A user with 'create bb_project' + 'view bb_project' may view but not
   * delete. Only the owner with 'delete own bb_project' may delete. A user
   * with no permissions is denied. 'administer bakers' bypasses all.
   */
  public function testGranularProjectAccess(): void {
    $project = \Drupal::entityTypeManager()->getStorage('bb_project')
      ->create(['name' => 'p1']);
    $this->assertInstanceOf(ContentEntityInterface::class, $project);
    $project->save();

    $creator = $this->createUser(['create bb_project', 'view bb_project']);
    $this->assertInstanceOf(UserInterface::class, $creator);
    $this->assertTrue($project->access('view', $creator));
    $this->assertFalse($project->access('delete', $creator));
    // view-only user must not be able to update.
    $this->assertFalse($project->access('update', $creator));

    $deleter = $this->createUser(['delete own bb_project']);
    $this->assertInstanceOf(UserInterface::class, $deleter);
    $this->assertFalse($project->access('delete', $deleter), 'delete own needs the project to be theirs');
    $project->set('owner_user_id', $deleter->id())->save();
    \Drupal::entityTypeManager()->getAccessControlHandler('bb_project')->resetCache();
    $this->assertTrue($project->access('delete', $deleter));

    $nobody = $this->createUser([]);
    $this->assertInstanceOf(UserInterface::class, $nobody);
    $this->assertFalse($project->access('view', $nobody));

    $admin = $this->createUser(['administer bakers']);
    $this->assertInstanceOf(UserInterface::class, $admin);
    $this->assertTrue($project->access('delete', $admin));

    // A user with 'edit bb_project' must be able to update the saved project.
    $editor = $this->createUser(['edit bb_project']);
    $this->assertInstanceOf(UserInterface::class, $editor);
    $this->assertTrue($project->access('update', $editor));
  }

  /**
   * An owner editing through `update own` cannot move the saved project.
   *
   * Teams are the owner's own gap; group and owner are server-maintained on a
   * saved row for every non-admin, editors included. A new project still
   * takes its teams from its creator.
   */
  public function testOwnerCannotMoveTheProject(): void {
    $owner = $this->createUser(['update own bb_project']);
    $editor = $this->createUser(['edit bb_project']);
    $this->assertInstanceOf(UserInterface::class, $owner);
    $this->assertInstanceOf(UserInterface::class, $editor);
    $project = \Drupal::entityTypeManager()->getStorage('bb_project')
      ->create(['name' => 'owned', 'owner_user_id' => $owner->id()]);
    $this->assertInstanceOf(ContentEntityInterface::class, $project);
    $project->save();

    $this->assertTrue($project->access('update', $owner));
    $facts = [];
    foreach (['teams', 'group_id', 'owner_user_id', 'name', 'repository'] as $field) {
      $facts[$field] = [
        $project->get($field)->access('edit', $owner),
        $project->get($field)->access('edit', $editor),
      ];
    }
    $this->assertSame([
      'teams' => [FALSE, TRUE],
      'group_id' => [FALSE, FALSE],
      'owner_user_id' => [FALSE, FALSE],
      'name' => [TRUE, TRUE],
      'repository' => [TRUE, TRUE],
    ], $facts);

    $new = \Drupal::entityTypeManager()->getStorage('bb_project')->create(['name' => 'new']);
    $this->assertInstanceOf(ContentEntityInterface::class, $new);
    $this->assertTrue($new->get('teams')->access('edit', $owner), 'a creator still picks the teams of a new project');
  }

}
