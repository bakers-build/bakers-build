<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Profile\Profiles;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The update moves position and background from the account into profiles.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProfileMigrationTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'dblog',
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
    $this->installSchema('user', ['users_data']);
    $this->installSchema('dblog', ['watchdog']);
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    $this->createUser([], 'uid1-dummy');
    foreach (['field_developer_title' => 'string', 'field_bb_background' => 'string_long'] as $name => $type) {
      FieldStorageConfig::create(['field_name' => $name, 'entity_type' => 'user', 'type' => $type])->save();
      FieldConfig::create(['field_name' => $name, 'entity_type' => 'user', 'bundle' => 'user', 'label' => $name])->save();
    }
  }

  /**
   * Each membership gets the values; empty and homeless accounts get none.
   */
  public function testValuesMoveIntoProfilesPerWorkspace(): void {
    $north = $this->workspace('north');
    $south = $this->workspace('south');
    $both = $this->person('Engineer', 'PHP.');
    $this->addMembership($north, $both, ['member']);
    $this->addMembership($south, $both, ['lead']);
    $blank = $this->person('', '');
    $this->addMembership($north, $blank, ['member']);
    $homeless = $this->person('Designer', '');
    $profiles = $this->container->get(Profiles::class);
    // Saved earlier, e.g. by a favorite: filled, not duplicated.
    $profiles->forAccount((int) $both->id(), (int) $north->id())->toggleFavorite(9)->save();

    $messages = $this->runUpdate();

    foreach ([$north, $south] as $workspace) {
      $profile = $profiles->forAccount((int) $both->id(), (int) $workspace->id());
      self::assertFalse($profile->isNew());
      self::assertSame(['Engineer', 'PHP.'], [$profile->position(), $profile->background()]);
    }
    self::assertSame([9], $profiles->forAccount((int) $both->id(), (int) $north->id())->favoriteProjectIds());
    self::assertSame([], $profiles->ofAccount((int) $blank->id()));
    self::assertSame([], $profiles->ofAccount((int) $homeless->id()));
    self::assertStringContainsString('uid ' . $homeless->id() . ': position "Designer"', $messages);
    self::assertCount(2, $this->container->get('entity_type.manager')->getStorage('bb_profile')->loadMultiple());

    self::assertNull(FieldStorageConfig::loadByName('user', 'field_developer_title'));
    self::assertNull(FieldStorageConfig::loadByName('user', 'field_bb_background'));
  }

  /**
   * Runs the batched post-update to the end.
   *
   * @return string
   *   The messages it returned.
   */
  private function runUpdate(): string {
    require_once $this->container->get('extension.list.module')->getPath('bb_core') . '/bb_core.post_update.php';
    $sandbox = [];
    $messages = '';
    $passes = 0;
    do {
      $messages .= (string) bb_core_post_update_user_profiles($sandbox);
      self::assertLessThan(50, ++$passes, 'the update finishes');
    } while (($sandbox['#finished'] ?? 1) < 1);
    return $messages;
  }

  /**
   * Creates an account with a position and background.
   */
  private function person(string $position, string $background): UserInterface {
    $user = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $user);
    $user->set('field_developer_title', $position)->set('field_bb_background', $background)->save();
    return $user;
  }

  /**
   * Creates a workspace.
   */
  private function workspace(string $slug): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => ucfirst($slug), 'slug' => $slug]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    return $workspace;
  }

}
