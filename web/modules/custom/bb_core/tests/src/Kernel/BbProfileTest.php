<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * One profile per account and workspace: position, background, favorites.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbProfileTest extends KernelTestBase {

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
    $this->installSchema('user', ['users_data']);
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    $this->createUser([], 'uid1-dummy');
  }

  /**
   * The service returns an unsaved profile first, then the stored one.
   */
  public function testProfileIsLoadedOrCreatedPerWorkspace(): void {
    $account = $this->person();
    $north = $this->workspace('north');
    $south = $this->workspace('south');
    $profiles = $this->container->get(Profiles::class);

    $profile = $profiles->forAccount((int) $account->id(), (int) $north->id());
    self::assertTrue($profile->isNew());
    $profile->setPosition('Backend engineer')->setBackground('PHP.')->toggleFavorite(7);
    $profile->save();

    $again = $profiles->forAccount((int) $account->id(), (int) $north->id());
    self::assertSame($profile->id(), $again->id());
    self::assertSame('Backend engineer', $again->position());
    self::assertSame('PHP.', $again->background());
    self::assertSame([7], $again->favoriteProjectIds());
    self::assertTrue($profiles->forAccount((int) $account->id(), (int) $south->id())->isNew());

    $again->toggleFavorite(7);
    self::assertSame([], $again->favoriteProjectIds());
  }

  /**
   * A second profile for the same account and workspace is refused.
   */
  public function testDuplicateAccountAndWorkspaceIsRefused(): void {
    $account = $this->person();
    $north = $this->workspace('north');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_profile');
    $storage->create(['uid' => $account->id(), 'workspace_id' => $north->id()])->save();

    $duplicate = $storage->create(['uid' => $account->id(), 'workspace_id' => $north->id()]);
    self::assertInstanceOf(BbProfileInterface::class, $duplicate);
    try {
      $duplicate->save();
      self::fail('A duplicate profile was stored.');
    }
    catch (EntityStorageException) {
      self::assertCount(1, $storage->loadMultiple());
    }
  }

  /**
   * A new profile starts from the newest profile's position and background.
   */
  public function testNewProfileCopiesTheNewestProfile(): void {
    $account = $this->person();
    $north = $this->workspace('north');
    $east = $this->workspace('east');
    $south = $this->workspace('south');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_profile');
    $storage->create([
      'uid' => $account->id(),
      'workspace_id' => $north->id(),
      'position' => 'Old title',
      'background' => 'Old.',
      'changed' => 100,
    ])->save();
    $storage->create([
      'uid' => $account->id(),
      'workspace_id' => $east->id(),
      'position' => 'Backend engineer',
      'background' => 'PHP.',
      'favorite_projects' => [7],
      'changed' => 200,
    ])->save();
    $this->setDefaultProfile($account, 'Onboarding title', 'Onboarding.');
    $profiles = $this->container->get(Profiles::class);

    $new = $profiles->forEditing((int) $account->id(), (int) $south->id());

    self::assertTrue($new->isNew());
    self::assertSame(['Backend engineer', 'PHP.'], [$new->position(), $new->background()]);
    self::assertSame([], $new->favoriteProjectIds(), 'favorites are not copied');
    $read = $profiles->forAccount((int) $account->id(), (int) $south->id());
    self::assertSame(['', ''], [$read->position(), $read->background()], 'readers see no unstored copy');
    $existing = $profiles->forEditing((int) $account->id(), (int) $north->id());
    self::assertSame(['Old title', 'Old.'], [$existing->position(), $existing->background()], 'an existing profile is never overwritten');
    $stranger = $profiles->forEditing((int) $this->person()->id(), (int) $south->id());
    self::assertSame(['', ''], [$stranger->position(), $stranger->background()], 'no earlier profile: empty');
  }

  /**
   * Joining a workspace, also by creating it, stores the copied profile.
   */
  public function testMembershipStoresCopiedProfile(): void {
    $account = $this->person();
    $north = $this->workspace('north');
    $south = $this->workspace('south');
    $profiles = $this->container->get(Profiles::class);
    $profiles->forAccount((int) $account->id(), (int) $north->id())->setPosition('Backend engineer')->setBackground('PHP.')->save();

    $this->addMembership($south, $account);

    $stored = $profiles->ofAccount((int) $account->id())[(int) $south->id()] ?? NULL;
    self::assertNotNull($stored, 'the new member has a stored profile');
    self::assertSame(['Backend engineer', 'PHP.'], [$stored->position(), $stored->background()]);

    $this->addMembership($north, $account);
    self::assertCount(2, $profiles->ofAccount((int) $account->id()), 'an existing profile stays the only one');

    $newcomer = $this->person();
    $this->setDefaultProfile($newcomer, '', '');
    $this->addMembership($south, $newcomer);
    self::assertSame([], $profiles->ofAccount((int) $newcomer->id()), 'no source profile: nothing stored');
  }

  /**
   * Without a stored profile, a new one starts from the default profile.
   */
  public function testNewProfileFallsBackToTheDefaultProfile(): void {
    $account = $this->person();
    $north = $this->workspace('north');
    $south = $this->workspace('south');
    $this->setDefaultProfile($account, 'Product Lead', 'I ship Drupal.');
    $profiles = $this->container->get(Profiles::class);

    $new = $profiles->forEditing((int) $account->id(), (int) $north->id());
    self::assertSame(['Product Lead', 'I ship Drupal.'], [$new->position(), $new->background()]);
    $read = $profiles->forAccount((int) $account->id(), (int) $north->id());
    self::assertSame(['', ''], [$read->position(), $read->background()], 'readers see no default profile');

    $this->addMembership($south, $account);
    $stored = $profiles->ofAccount((int) $account->id())[(int) $south->id()] ?? NULL;
    self::assertNotNull($stored, 'the first workspace stores the default profile');
    self::assertSame(['Product Lead', 'I ship Drupal.'], [$stored->position(), $stored->background()]);
  }

  /**
   * Deleting the account removes its default profile.
   */
  public function testAccountDeletionClearsTheDefaultProfile(): void {
    $account = $this->person();
    $this->setDefaultProfile($account, 'Product Lead', 'I ship Drupal.');
    $uid = (int) $account->id();

    $account->delete();

    self::assertNull($this->container->get('user.data')->get('bb_core', $uid, 'default_profile'));
  }

  /**
   * Stores the account's default profile as the onboarding wizard does.
   */
  private function setDefaultProfile(UserInterface $account, string $position, string $background): void {
    $this->container->get(Profiles::class)->setDefaultProfile((int) $account->id(), $position, $background);
  }

  /**
   * Creates an account.
   */
  private function person(): UserInterface {
    $user = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $user);
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
