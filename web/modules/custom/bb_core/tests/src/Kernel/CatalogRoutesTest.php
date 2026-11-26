<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Catalog lives under workspace settings and its tabs open to readers.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CatalogRoutesTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'display_builder', 'display_builder_views', 'island',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->installConfig(['views']);
    $this->installShippedView('views.view.bb_terms');
    $this->installShippedView('views.view.bb_environments');
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Each Catalog page sits under workspace settings; terms keep their gate.
   */
  public function testCatalogPagesLiveUnderSettings(): void {
    $provider = $this->container->get('router.route_provider');
    $paths = [
      'view.bb_environments.catalog' => 'environments',
      'entity.bb_environment.add_for_workspace' => 'environments/add',
    ];
    foreach ($paths as $name => $tail) {
      self::assertSame('/_workspace/{bb_workspace}/settings/catalog/' . $tail, $provider->getRouteByName($name)->getPath());
    }
    foreach (['types', 'recipes', 'labels'] as $tab) {
      $route = $provider->getRouteByName('view.bb_terms.' . $tab);
      self::assertSame('/_workspace/{bb_workspace}/settings/catalog/' . $tab, $route->getPath());
      self::assertSame('view bb_term', $route->getRequirement('_bb_workspace_permission'));
      self::assertNull($route->getRequirement('_entity_access'), 'The settings lead gate is gone.');
    }
  }

  /**
   * Catalog is a settings tab; its four pages are its second tab row.
   */
  public function testCatalogIsSettingsTabWithFourChildren(): void {
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    $catalog = $tasks['bb_core.bb_workspace.catalog'];
    self::assertSame('bb_core.bb_workspace.settings', $catalog['base_route']);
    self::assertSame('view.bb_terms.types', $catalog['route_name']);
    self::assertGreaterThan($tasks['bb_core.bb_workspace.templates']['weight'], $catalog['weight'], 'Catalog follows Templates.');
    $weight = -1;
    foreach (['types' => 'Types', 'recipes' => 'Recipes', 'labels' => 'Labels', 'environments' => 'Environments'] as $id => $title) {
      $task = $tasks['bb_core.catalog.' . $id];
      self::assertSame('bb_core.bb_workspace.catalog', $task['parent_id']);
      self::assertSame($title, (string) $task['title']);
      self::assertGreaterThan($weight, $task['weight']);
      $weight = $task['weight'];
    }
  }

  /**
   * Terms and environments have no page of their own.
   */
  public function testNoCanonical(): void {
    $provider = $this->container->get('router.route_provider');
    $manager = $this->container->get('entity_type.manager');
    foreach (['bb_term', 'bb_environment'] as $type) {
      self::assertFalse($manager->getDefinition($type)->hasLinkTemplate('canonical'), $type);
      self::assertSame([], $provider->getRoutesByNames(["entity.$type.canonical"]), $type);
      self::assertNotNull($provider->getRouteByName("entity.$type.edit_form"));
    }
  }

  /**
   * A guest lists terms in its own workspace and nowhere else.
   */
  public function testGuestListsTermsOnlyInItsWorkspace(): void {
    $guest = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $access = $this->container->get('access_manager');

    self::assertTrue($access->checkNamedRoute('view.bb_terms.types', ['bb_workspace' => 'space-a'], $guest));
    self::assertFalse($access->checkNamedRoute('view.bb_terms.types', ['bb_workspace' => 'space-b'], $guest));
  }

}
