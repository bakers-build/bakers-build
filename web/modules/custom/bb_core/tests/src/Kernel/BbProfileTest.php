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
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project', 'bb_profile'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
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
