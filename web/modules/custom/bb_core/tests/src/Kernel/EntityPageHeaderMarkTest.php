<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\file\Entity\File;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The `bb_entity_page_header_mark` source on a team page.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityPageHeaderMarkTest extends KernelTestBase {

  use UserCreationTrait;
  use RailRequestTrait;
  use OgScopeFixtureTrait;
  use ShippedImageConfigTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'bb_core', 'views',
  ];

  /**
   * The team whose page is visited, its reader a member.
   */
  private BbTeamInterface $team;

  /**
   * {@inheritdoc}
   */
  protected function setUpFilesystem(): void {
    parent::setUpFilesystem();
    // Before the container is built, so the private stream wrapper exists.
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project', 'file', 'crop'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['system', 'user']);
    $this->installAvatarStyle();
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    $this->setUpCurrentUser(['uid' => 1]);

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $team = $etm->getStorage('bb_team')->create(['name' => 'Platform Crew', 'workspace_id' => $workspace->id()]);
    $team->save();
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->team = $team;

    $member = $this->createUser([], 'crew-member');
    self::assertInstanceOf(UserInterface::class, $member);
    $this->addMembership($workspace, $member, ['contributor']);
    $this->addMembership($team, $member, ['member']);
    $this->setCurrentUser($member);
  }

  /**
   * A team page without an image shows the initials, with one its avatar.
   */
  public function testTeamPageShowsTheTeamImage(): void {
    $this->visit('entity.bb_team.canonical', ['bb_workspace' => 'acme', 'bb_team' => $this->team->id()]);
    $props = $this->mark()['#props'] ?? [];
    self::assertSame('', $props['picture'] ?? NULL);
    self::assertSame('PC', $props['initials'] ?? NULL);

    $this->team->set('image', $this->privateImage())->save();
    $this->visit('entity.bb_team.canonical', ['bb_workspace' => 'acme', 'bb_team' => $this->team->id()]);
    $props = $this->mark()['#props'] ?? [];
    self::assertStringContainsString('/system/files/styles/avatar/private/team-images/', (string) ($props['picture'] ?? ''));
  }

  /**
   * The source's value on the current route.
   *
   * @return array<string, mixed>
   *   The component build, or [] off an entity place.
   */
  private function mark(): array {
    $prop_definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $configuration = SourcePluginBase::buildConfiguration('leading', $prop_definition, ['source' => []], []);
    $value = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_entity_page_header_mark', $configuration)
      ->getPropValue();
    self::assertIsArray($value);
    return $value;
  }

  /**
   * A permanent private PNG in the team image directory.
   */
  private function privateImage(): int {
    $directory = 'private://team-images';
    $this->container->get('file_system')->prepareDirectory($directory, 1);
    $uri = $directory . '/crew-' . uniqid() . '.png';
    file_put_contents($uri, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $file = File::create(['uri' => $uri, 'status' => 1]);
    $file->save();
    return (int) $file->id();
  }

}
