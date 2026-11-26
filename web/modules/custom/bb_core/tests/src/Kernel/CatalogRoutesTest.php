<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The shipped term tabs live under Catalog and open to term readers.
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
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Each term tab has its Catalog path and the term read gate.
   */
  public function testTermTabsLiveUnderCatalog(): void {
    $provider = $this->container->get('router.route_provider');
    foreach (['types', 'recipes', 'labels'] as $tab) {
      $route = $provider->getRouteByName('view.bb_terms.' . $tab);
      self::assertSame('/_workspace/{bb_workspace}/catalog/' . $tab, $route->getPath());
      self::assertSame('view bb_term', $route->getRequirement('_bb_workspace_permission'));
      self::assertNull($route->getRequirement('_entity_access'), 'The settings lead gate is gone.');
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
