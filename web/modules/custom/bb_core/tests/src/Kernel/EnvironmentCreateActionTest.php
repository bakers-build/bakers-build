<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The "Add environment" header action of the Catalog Environments tab.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EnvironmentCreateActionTest extends KernelTestBase {

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
    'link', 'text', 'filter', 'field', 'og', 'views', 'better_exposed_filters', 'markdown_easy',
    'ui_patterns', 'ui_patterns_views', 'display_builder', 'display_builder_views', 'island',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system', 'views']);
    $this->buildTwoWorkspaceWorld();
    $this->fixture('a', 'bb_workspace')->set('slug', 'space-a')->save();
    $this->installShippedView('views.view.bb_environments');
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * A lead gets the action, opening the workspace add form.
   */
  public function testLeadGetsTheAddAction(): void {
    $this->actAs('lead');

    $build = $this->action();

    self::assertSame('bb_theme:button', $build['#component'] ?? NULL);
    self::assertSame('Add environment', $build['#props']['label']);
    self::assertStringContainsString('/space-a/settings/catalog/environments/add', $build['#props']['href']);
  }

  /**
   * A contributor reads the tab but gets no action.
   */
  public function testContributorGetsNoAction(): void {
    $this->actAs('contributor');

    self::assertArrayNotHasKey('#component', $this->action());
  }

  /**
   * Makes a member of workspace A with the rank current, on the tab's route.
   */
  private function actAs(string $rank): UserInterface {
    $account = $this->createAccount("north-$rank");
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, [$rank]);
    $this->container->get('current_user')->setAccount($account);
    $request = Request::create('/space-a/settings/catalog/environments');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      '_route' => 'view.bb_environments.catalog',
      '_route_object' => $this->container->get('router.route_provider')->getRouteByName('view.bb_environments.catalog'),
      'bb_workspace' => $this->fixture('a', 'bb_workspace'),
    ]);
    $this->container->get('request_stack')->push($request);
    return $account;
  }

  /**
   * The action's build on the current route.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function action(): array {
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_environment_create_action', SourcePluginBase::buildConfiguration('items', $schema, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    return $source->getPropValue();
  }

}
