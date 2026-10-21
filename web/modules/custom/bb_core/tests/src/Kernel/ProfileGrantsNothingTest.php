<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * AC-12: saving the onboarding profile fields grants no access whatsoever.
 *
 * The profile fields (`field_developer_title`, `field_bb_background`) are
 * plain descriptive profile data. Saving them
 * must not touch the account's roles or its og_membership rows — there is no
 * hidden side effect wiring profile answers to permissions or group
 * membership. This is a regression guard: it may already pass before any
 * access-control change in this ticket, which is correct.
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
      'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createUser([], 'uid1-dummy');
    $this->installOnboardingFields();
  }

  /**
   * Installs the profile fields from config/sync.
   *
   * They live only at the repository's top level, so `installConfig` cannot
   * reach them — same pattern as `RecipientProfileTest`.
   */
  private function installOnboardingFields(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    foreach (['field_developer_title', 'field_bb_background'] as $name) {
      $storageData = $storage->read("field.storage.user.$name");
      self::assertIsArray($storageData, "config/sync/field.storage.user.$name.yml exists.");
      FieldStorageConfig::create($storageData)->save();
      $fieldData = $storage->read("field.field.user.user.$name");
      self::assertIsArray($fieldData, "config/sync/field.field.user.user.$name.yml exists.");
      FieldConfig::create($fieldData)->save();
    }
  }

  /**
   * Saving the profile fields leaves roles and og_membership untouched.
   */
  public function testSavingProfileFieldsGrantsNothing(): void {
    $user = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $user);

    $membership_storage = $this->container->get('entity_type.manager')->getStorage('og_membership');
    $roles_before = $user->getRoles();
    $memberships_before = $membership_storage->loadMultiple();

    $user->set('field_developer_title', 'Backend engineer')
      ->set('field_bb_background', 'Drupal developer, confident with PHP.')
      ->save();

    $reloaded = $this->container->get('entity_type.manager')->getStorage('user')->loadUnchanged($user->id());
    self::assertInstanceOf(UserInterface::class, $reloaded);
    $roles_after = $reloaded->getRoles();
    $membership_storage->resetCache();
    $memberships_after = $membership_storage->loadMultiple();

    self::assertSame($roles_before, $roles_after, 'Saving the onboarding profile fields must not change the account roles.');
    self::assertEquals(
      array_map(static fn ($m) => $m->toArray(), $memberships_before),
      array_map(static fn ($m) => $m->toArray(), $memberships_after),
      'Saving the onboarding profile fields must not change any og_membership row.',
    );
  }

}
