<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandInterface;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The project overview's favorite toggle island: state, access, ownership.
 *
 * The action's CSRF token and the page wiring belong to the island module;
 * the browser scenario covers the toggle on the real page.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectFavoriteToggleTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;
  use RailRequestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'ui_patterns', 'island', 'bb_core',
  ];

  /**
   * The project's workspace.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The project under test.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project', 'bb_profile'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser([], 'uid1-dummy');
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $group = $etm->getStorage('bb_group')->create(['name' => 'Platform Group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'Platform',
      'key' => 'PLAT',
      'group_id' => $group->id(),
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
  }

  /**
   * A viewer marks and unmarks; another account's favorites stay untouched.
   */
  public function testViewerTogglesOwnFavoriteOnly(): void {
    $lead = $this->lead();
    $colleague = $this->lead();
    $this->setCurrentUser($lead);
    $this->visit('entity.bb_project.canonical', $this->parameters());
    $profiles = $this->container->get(Profiles::class);

    self::assertTrue($this->island()->accessAction('toggle', [], $lead)->isAllowed());
    $this->toggle();
    self::assertSame([(int) $this->project->id()], $profiles->forAccount((int) $lead->id(), (int) $this->workspace->id())->favoriteProjectIds());
    self::assertTrue($profiles->forAccount((int) $colleague->id(), (int) $this->workspace->id())->isNew(), 'another account is untouched');

    $this->toggle();
    self::assertSame([], $profiles->forAccount((int) $lead->id(), (int) $this->workspace->id())->favoriteProjectIds());
  }

  /**
   * A toggle swaps the island itself and announces the change to the page.
   */
  public function testToggleRebuildsItselfAndAnnouncesTheChange(): void {
    $this->lead();
    $this->visit('entity.bb_project.canonical', $this->parameters());
    $response = $this->island()->applyAction('toggle', []);
    self::assertTrue($response->shouldRebuildSelf());
    self::assertSame(['bakers.favorites.changed'], array_keys($response->getEvents()));
  }

  /**
   * Accounts that may not view the project, anonymous and other pages: no.
   */
  public function testNonViewerAnonymousAndOtherPagesAreRefused(): void {
    $outsider = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);
    $this->visit('entity.bb_project.canonical', $this->parameters());
    self::assertFalse($this->island()->accessAction('toggle', [], $outsider)->isAllowed(), 'non-viewer');
    self::assertArrayNotHasKey('#component', $this->island()->build(), 'non-viewer sees no toggle');

    $anonymous = User::getAnonymousUser();
    $this->setCurrentUser($anonymous);
    self::assertFalse($this->island()->accessAction('toggle', [], $anonymous)->isAllowed(), 'anonymous');

    $lead = $this->lead();
    self::assertFalse($this->island()->accessAction('unknown', [], $lead)->isAllowed(), 'unknown action');
    $this->visit('bb_core.home');
    self::assertFalse($this->island()->accessAction('toggle', [], $lead)->isAllowed(), 'another route');
    self::assertArrayNotHasKey('#component', $this->island()->build(), 'another route shows no toggle');
  }

  /**
   * The toggle names and shows the state, per account.
   */
  public function testToggleNamesTheState(): void {
    $this->lead();
    $this->visit('entity.bb_project.canonical', $this->parameters());
    $toggle = $this->island()->build();
    self::assertSame('bb_theme:button', $toggle['#component']);
    self::assertSame('Add to favorites', (string) $toggle['#props']['label']);
    self::assertFalse($toggle['#props']['pressed']);
    self::assertTrue($toggle['#props']['icon_only']);
    self::assertContains('user', $toggle['#cache']['contexts']);
    self::assertContains('bb_profile_list', $toggle['#cache']['tags']);

    $this->toggle();
    $toggle = $this->island()->build();
    self::assertSame('Remove from favorites', (string) $toggle['#props']['label']);
    self::assertTrue($toggle['#props']['pressed']);
  }

  /**
   * The toggle island as the shell page header embeds it.
   */
  private function island(): IslandInterface {
    $host = new class() implements IslandContextProviderInterface {

      /**
       * {@inheritdoc}
       */
      public function hostId(): string {
        return 'bb_shell';
      }

      /**
       * {@inheritdoc}
       */
      public function getIslandIds(): array {
        return ['shell_project_favorite'];
      }

      /**
       * {@inheritdoc}
       */
      public function getIslandConfiguration(string $island_id): array {
        return [];
      }

      /**
       * {@inheritdoc}
       */
      public function getIslandData(string $island_id): array {
        return [];
      }

    };
    $island = $this->container->get('plugin.manager.island')->createInstance('bb_project_favorite', [
      'contexts' => ['host' => $host, 'placement_id' => 'shell_project_favorite'],
    ]);
    self::assertInstanceOf(IslandInterface::class, $island);
    return $island;
  }

  /**
   * Applies the toggle as the current account.
   */
  private function toggle(): void {
    $this->island()->applyAction('toggle', []);
    $this->container->get('entity_type.manager')->getStorage('bb_profile')->resetCache();
  }

  /**
   * A lead of the workspace, made the current account.
   */
  private function lead(): UserInterface {
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    return $lead;
  }

  /**
   * The route parameters for the project.
   *
   * @return array<string, int|string>
   *   Workspace slug and project id.
   */
  private function parameters(): array {
    return ['bb_workspace' => 'acme', 'bb_project' => (int) $this->project->id()];
  }

}
