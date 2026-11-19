<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Profile\Profiles;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * AC-12: saving a profile grants no access whatsoever.
 *
 * A `bb_profile` (position, background, favorite projects) is plain
 * descriptive data. Saving it must not touch the account's roles, its
 * og_membership rows or what it may view — no hidden side effect wiring
 * profile answers to permissions or group membership.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProfileGrantsNothingTest extends KernelTestBase {

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
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_workspace', 'bb_profile',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createUser([], 'uid1-dummy');
  }

  /**
   * Saving a profile, favorites included, leaves roles and access untouched.
   */
  public function testSavingProfileFieldsGrantsNothing(): void {
    $user = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $user);

    $membership_storage = $this->container->get('entity_type.manager')->getStorage('og_membership');
    $roles_before = $user->getRoles();
    $memberships_before = $membership_storage->loadMultiple();

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'North', 'slug' => 'north']);
    $workspace->save();
    $group = $etm->getStorage('bb_group')->create(['name' => 'Group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create(['name' => 'Foreign', 'key' => 'FOR', 'group_id' => $group->id()]);
    $project->save();
    self::assertFalse($project->access('view', $user));
    $this->container->get(Profiles::class)->forAccount((int) $user->id(), (int) $workspace->id())
      ->setPosition('Backend engineer')
      ->setBackground('Drupal developer, confident with PHP.')
      ->toggleFavorite((int) $project->id())
      ->save();
    $etm->getAccessControlHandler('bb_project')->resetCache();
    self::assertFalse($project->access('view', $user), 'a favorite grants no view access');

    $reloaded = $this->container->get('entity_type.manager')->getStorage('user')->loadUnchanged($user->id());
    self::assertInstanceOf(UserInterface::class, $reloaded);
    $roles_after = $reloaded->getRoles();
    $membership_storage->resetCache();
    $memberships_after = $membership_storage->loadMultiple();

    self::assertSame($roles_before, $roles_after, 'Saving a profile must not change the account roles.');
    self::assertEquals(
      array_map(static fn ($m) => $m->toArray(), $memberships_before),
      array_map(static fn ($m) => $m->toArray(), $memberships_after),
      'Saving a profile must not change any og_membership row.',
    );
  }

}
