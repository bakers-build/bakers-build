<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use Drupal\views\Plugin\views\field\Broken;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The workspace addon overview lists every registered addon once.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonOverviewViewTest extends KernelTestBase {

  use AddonFixtureTrait;
  use InboxWorldTrait;
  use ProjectsViewTestTrait;

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
    $this->installShippedView('views.view.addons');
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
   * Every field of the page resolves to a real handler.
   */
  public function testNoBrokenHandler(): void {
    $view = Views::getView('addons');
    self::assertNotNull($view);
    $view->setDisplay('settings');
    $view->initHandlers();
    self::assertSame(
      ['icon', 'label', 'name', 'versions', 'contract', 'conductors'],
      array_keys($view->field),
    );
    foreach ($view->field as $id => $handler) {
      self::assertNotInstanceOf(Broken::class, $handler, "The $id field is broken.");
    }
  }

}
