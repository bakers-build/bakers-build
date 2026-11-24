<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use Drupal\Tests\bb_core\Kernel\RowViewModeTestTrait;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;

/**
 * The workspace addon overview lists every registered addon once.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonOverviewViewTest extends KernelTestBase {

  use AddonFixtureTrait;
  use InboxWorldTrait;
  use ProjectsViewTestTrait;
  use RowViewModeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources', 'views',
    'better_exposed_filters', 'island', 'ui_patterns', 'ui_patterns_views',
    'ui_patterns_field', 'ui_patterns_field_formatters',
    'display_builder', 'display_builder_views', 'display_builder_entity_view',
    'bb_core', 'bb_inbox', 'bb_addon',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->buildInboxWorld();
    $this->installEntitySchema('bb_addon');
    $this->installConfig(['system', 'views']);
    $this->installRowViewMode('bb_addon', 'list_item');
    $this->installShippedView('views.view.addons');
    // The row components live in the theme.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * One row per name, sorted by name; the row is the name's newest version.
   */
  public function testOneRowPerNameAtItsNewestVersion(): void {
    $time = $this->container->get('datetime.time')->getRequestTime();
    $old = $this->storeAddon(self::portsDefinition('1.0.0'), [$this->conductor]);
    $old->set('created', $time - 60)->save();
    $new = $this->storeAddon(self::portsDefinition('1.1.0'), [], (int) $this->fixture('a', 'bb_workspace')->id());
    // Same second as $new: the higher id is the newer row.
    $newest = $this->storeAddon(self::portsDefinition('1.2.0'), [], (int) $this->fixture('a', 'bb_workspace')->id());
    $bare = $this->storeAddon(['name' => 'bare', 'version' => '1.0.0', 'contract' => 1], [], (int) $this->fixture('a', 'bb_workspace')->id());

    $this->container->get('current_user')->setAccount($this->contributor);
    $workspace = $this->fixture('a', 'bb_workspace');
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    // The world's workspaces carry no slug; the route segment is one.
    $workspace->set('slug', 'workspace-a')->save();
    self::assertSame(
      [(string) $bare->id(), (string) $newest->id()],
      $this->viewResultIds('addons', ['workspace-a'], 'settings'),
    );
    self::assertNotSame($new->id(), $newest->id());
  }

  /**
   * A row is the addon in its list-item view mode, in the listing's regions.
   */
  public function testRowIsTheAddonInItsListItemMode(): void {
    $workspace = $this->fixture('a', 'bb_workspace');
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->set('slug', 'workspace-a')->save();
    $this->storeAddon(self::portsDefinition('1.2.0'), [], (int) $workspace->id());
    $this->container->get('current_user')->setAccount($this->contributor);

    $view = Views::getView('addons');
    self::assertNotNull($view);
    $view->setDisplay('settings');
    $view->setArguments(['workspace-a']);
    $view->execute();
    // Entity rows are built in the style's pre-render, as View::render() does.
    $view->style_plugin->preRender($view->result);
    $build = $view->style_plugin->render();
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    $item = (new Crawler($html))->filter('ul[role="list"] > li[data-list-item]');
    self::assertCount(1, $item, 'One addon, one row.');
    $cells = static fn (string $region): array => $item->filter("[data-list-region=\"$region\"] > [data-cell]")->each(
      static fn (Crawler $cell): string => (string) $cell->attr('data-cell'),
    );
    self::assertSame(['icon'], $cells('avatar'));
    self::assertSame(['label', 'name'], $cells('headline'));
    self::assertSame(['versions', 'contract'], $cells('meta'));
    self::assertSame(['conductors'], $cells('right'));
    self::assertSame('Ports', trim($item->filter('[data-cell="label"]')->text()));
    self::assertSame(['Versions', 'Contract'], $item->filter('[data-list-region="meta"] [data-cell-label]')->each(
      static fn (Crawler $label): string => trim($label->text()),
    ));
  }

}
