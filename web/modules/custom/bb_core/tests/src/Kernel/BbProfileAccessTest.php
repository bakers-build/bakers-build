<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Who views, edits and deletes a profile.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbProfileAccessTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project', 'bb_profile'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    $this->createUser([], 'uid1-dummy');
  }

  /**
   * Owner edits; members of the workspace only view; others nothing.
   */
  public function testOwnerEditsMembersViewOthersNothing(): void {
    $north = $this->workspace('north');
    $south = $this->workspace('south');
    $owner = $this->person();
    $colleague = $this->person(['access user profiles']);
    $outsider = $this->person(['access user profiles']);
    $admin = $this->person(['administer bakers']);
    foreach ([$owner, $colleague] as $account) {
      $this->addMembership($north, $account, ['member']);
    }
    $this->addMembership($south, $outsider, ['lead']);
    $profile = $this->container->get(Profiles::class)->forAccount((int) $owner->id(), (int) $north->id());
    $profile->setPosition('Engineer')->save();

    self::assertTrue($profile->access('view', $owner));
    self::assertTrue($profile->access('update', $owner));
    self::assertFalse($profile->access('delete', $owner), 'delete is admin only');

    self::assertTrue($profile->access('view', $colleague), 'a member of the workspace who may view the person');
    self::assertFalse($profile->access('update', $colleague));

    self::assertFalse($profile->access('view', $outsider), 'a lead of another workspace');
    self::assertFalse($profile->access('update', $outsider));
    self::assertFalse($profile->access('view', User::getAnonymousUser()));
    self::assertFalse($profile->access('create', $owner) || $this->container->get('entity_type.manager')->getAccessControlHandler('bb_profile')->createAccess(NULL, $owner));

    self::assertTrue($profile->access('update', $admin));
    self::assertTrue($profile->access('delete', $admin));
  }

  /**
   * A member who may not view the person does not read the profile either.
   */
  public function testMemberWithoutUserViewAccessIsDenied(): void {
    $north = $this->workspace('north');
    $owner = $this->person();
    $colleague = $this->person();
    $this->addMembership($north, $owner, ['member']);
    $this->addMembership($north, $colleague, ['member']);
    $profile = $this->container->get(Profiles::class)->forAccount((int) $owner->id(), (int) $north->id());
    $profile->save();
    self::assertInstanceOf(BbProfileInterface::class, $profile);

    self::assertFalse($profile->access('view', $colleague));
  }

  /**
   * Creates an account with the given permissions.
   *
   * @param array<string> $permissions
   *   Site permissions.
   */
  private function person(array $permissions = []): UserInterface {
    $user = $this->createUser($permissions);
    self::assertInstanceOf(UserInterface::class, $user);
    return $user;
  }

  /**
   * Creates a workspace.
   */
  private function workspace(string $slug): object {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => ucfirst($slug), 'slug' => $slug]);
    $workspace->save();
    return $workspace;
  }

}
