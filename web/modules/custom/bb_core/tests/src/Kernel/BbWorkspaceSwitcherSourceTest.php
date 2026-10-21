<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\file\Entity\File;
use Drupal\og\Og;
use Drupal\user\Entity\User;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbWorkspaceSwitcherPanelSource;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbWorkspaceSwitcherSource;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;

/**
 * The rail-head switcher reads the ambient workspace and the account's set.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbWorkspaceSwitcherSourceTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  use UserCreationTrait;
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
   * The ambient workspace.
   */
  private BbWorkspaceInterface $workspace;

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
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installConfig(['system', 'user']);
    $this->installEntitySchema('crop');
    $this->installAvatarStyle();
    $this->setUpCurrentUser(['uid' => 1]);

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme Corp', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $other = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Beta', 'slug' => 'beta']);
    $other->save();

    View::create([
      'id' => 'tickets',
      'label' => 'Ticket navigation routes',
      'base_table' => 'users_field_data',
      'base_field' => 'uid',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_plugin' => 'default',
          'display_options' => ['access' => ['type' => 'none']],
        ],
        'my_work' => [
          'id' => 'my_work',
          'display_plugin' => 'page',
          'display_options' => ['path' => '_workspace/%bb_workspace/tickets'],
        ],
      ],
    ])->save();
    $this->container->get('router.builder')->rebuild();

    $route = new Route('/_workspace/{bb_workspace}/tickets');
    $request = Request::create('/acme/tickets');
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'view.tickets.my_work');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $this->container->get('request_stack')->push($request);
    $this->container->get('router.request_context')->fromRequest($request);
  }

  /**
   * The ambient workspace names the switcher.
   */
  public function testAmbientWorkspaceNamesTheSwitcher(): void {
    self::assertSame('Acme Corp', $this->propValue('workspace_label'));
    self::assertSame('AC', $this->propValue('workspace_initials'));
    self::assertTrue($this->propValue('multiple'));
  }

  /**
   * A workspace-free account route still supplies the required SDC label.
   */
  public function testWorkspaceFreeRouteHasSwitcherLabel(): void {
    $request = Request::create('/user/password');
    $request->setSession($this->container->get('request_stack')->getSession());
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'user.pass');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, new Route('/user/password'));
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
    self::assertSame('Workspaces', $this->propValue('workspace_label'));
    self::assertSame('W', $this->propValue('workspace_initials'));
  }

  /**
   * Direct profile entry must never borrow the default workspace.
   */
  public function testProfileRequiresExplicitOrigin(): void {
    $this->workspace->set('slug', BbWorkspace::DEFAULT_SLUG)->save();
    $request = Request::create('/user/1');
    $request->setSession($this->container->get('request_stack')->getSession());
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'entity.user.canonical');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, new Route('/user/{user}'));
    $request->attributes->set('user', User::load(1));
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
    self::assertSame('Workspaces', $this->propValue('workspace_label'));
    $request->query->set('workspace', $this->workspace->uuid());
    self::assertSame('Acme Corp', $this->propValue('workspace_label'));
    $cache = $this->source('workspace_label')->alterComponent([])['#cache'];
    self::assertContains('url.query_args:workspace', $cache['contexts']);
    self::assertContains('user.permissions', $cache['contexts']);
    self::assertContains('url.query_args:workspace', $this->panel()['#cache']['contexts']);
  }

  /**
   * The panel lists every workspace the account may enter.
   */
  public function testPanelListsEveryReachableWorkspace(): void {
    $panel = $this->panel();
    $titles = [];
    foreach ($panel as $delta => $item) {
      if (!is_int($delta)) {
        continue;
      }
      $titles[] = (string) $item['#props']['label'];
    }
    sort($titles);
    self::assertSame(['Acme Corp', 'Beta'], $titles);
  }

  /**
   * The workspace image reaches the mark; descriptions stay out of the panel.
   */
  public function testImageReachesTheSwitcherWithoutDescription(): void {
    self::assertSame('', $this->propValue('workspace_picture'), 'No image: initials.');
    // Viewing a workspace, and so downloading its image, needs membership.
    $this->joinAcme();

    $this->workspace->set('image', $this->privateImage())->set('description', "Where Acme ships.\nAnd where it builds.")->save();
    $picture = (string) $this->propValue('workspace_picture');
    self::assertStringContainsString('/system/files/styles/avatar/private/workspace-images/', $picture, 'The square crop, privately served.');
    $acme = $this->panelEntry('Acme Corp');
    self::assertSame($picture, $acme['mark']['picture']);
    self::assertSame('AC', $acme['mark']['initials']);
    self::assertArrayNotHasKey('description', $acme);
    $beta = $this->panelEntry('Beta');
    self::assertSame('', $beta['mark']['picture']);
    self::assertArrayNotHasKey('description', $beta);

    // The absolute crop URL varies by site, in the panel and on the trigger;
    // the trigger carries it through alterComponent(), as getPropValue()
    // discards metadata.
    self::assertContains('url.site', $this->panel()['#cache']['contexts'] ?? []);
    $trigger = $this->source('workspace_picture')->alterComponent([]);
    self::assertContains('url.site', $trigger['#cache']['contexts'] ?? []);
  }

  /**
   * A deleted or forbidden image leaves the initials.
   */
  public function testUnavailableImageFallsBackToInitials(): void {
    $this->workspace->set('image', ['target_id' => 987654])->save();
    self::assertSame('', $this->propValue('workspace_picture'));

    $this->workspace->set('image', $this->privateImage())->save();
    $this->joinAcme();
    self::assertNotSame('', $this->propValue('workspace_picture'), 'A member sees the image.');
    // An account that may not view the workspace may not download its image.
    $this->setUpCurrentUser([], []);
    self::assertSame('', $this->propValue('workspace_picture'));
  }

  /**
   * Makes uid 1 a member of Acme, registering the shipped OG groups first.
   */
  private function joinAcme(): void {
    $this->installOgScopeFixture();
    Og::createMembership($this->workspace, User::load(1))->save();
  }

  /**
   * A permanent private PNG in the workspace image directory.
   */
  private function privateImage(): int {
    $directory = 'private://workspace-images';
    $this->container->get('file_system')->prepareDirectory($directory, 1);
    $uri = $directory . '/acme-' . uniqid() . '.png';
    file_put_contents($uri, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $file = File::create(['uri' => $uri, 'status' => 1]);
    $file->save();
    return (int) $file->id();
  }

  /**
   * The panel entry's props for a workspace label.
   *
   * @return array<string, mixed>
   *   The menu item props.
   */
  private function panelEntry(string $label): array {
    foreach ($this->panel() as $delta => $item) {
      if (is_int($delta) && (string) $item['#props']['label'] === $label) {
        return $item['#props'];
      }
    }
    self::fail("No panel entry for $label.");
  }

  /**
   * One named prop from the switcher source.
   */
  private function propValue(string $prop_id): mixed {
    return $this->source($prop_id)->getPropValue();
  }

  /**
   * The switcher source for one named prop.
   */
  private function source(string $prop_id): BbWorkspaceSwitcherSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition($prop_id === 'multiple' ? 'boolean' : 'string')['schema'];
    $configuration = SourcePluginBase::buildConfiguration(
      $prop_id,
      $definition,
      ['source' => []],
      [],
    );
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_workspace_switcher', $configuration);
    self::assertInstanceOf(BbWorkspaceSwitcherSource::class, $source);
    return $source;
  }

  /**
   * The panel source's render array.
   *
   * @return array<string, mixed>
   *   The slot payload.
   */
  private function panel(): array {
    $configuration = SourcePluginBase::buildConfiguration(
      'workspace_panel',
      ['type' => 'array'],
      ['source' => []],
      [],
    );
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_workspace_switcher_panel', $configuration);
    self::assertInstanceOf(BbWorkspaceSwitcherPanelSource::class, $source);
    $value = $source->getPropValue();
    self::assertIsArray($value);
    return $value;
  }

}
