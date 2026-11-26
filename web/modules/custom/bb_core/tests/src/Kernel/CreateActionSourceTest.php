<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The create-action source renders the screen's dialog local actions.
 *
 * Fixtures: `bb_create_action_test.links.action.yml`, one action per rule.
 */
#[Group('bb_core')]
final class CreateActionSourceTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'markdown_easy', 'og', 'state_machine', 'views', 'better_exposed_filters', 'island',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views', 'bb_core', 'bb_create_action_test',
  ];

  /**
   * The workspace every screen is entered with.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team', 'bb_project', 'bb_profile'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('user', ['users_data']);
    $this->installConfig(['system', 'user']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->createUser([], 'uid1-dummy');
    $account = $this->createUser(['administer bakers', 'create bb_group', 'create bb_team']);
    self::assertNotFalse($account);
    $this->setCurrentUser($account);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_workspace');
    $workspace = $storage->create(['name' => 'A', 'slug' => 'workspace-a']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $storage->create(['name' => 'B', 'slug' => 'workspace-b'])->save();
    $this->container->get('router.builder')->rebuild();
    $this->enterScreen();
  }

  /**
   * Only dialog actions of this screen render, each labelled by its title.
   */
  public function testOnlyThisScreensDialogActionsRender(): void {
    $triggers = $this->triggers();
    self::assertSame(['New team', 'Overlaid', 'Listed query', 'All query', 'Bound', 'With id'], array_keys($triggers));
    self::assertSame('bb_theme:button', $triggers['New team']['#component']);
    self::assertStringContainsString('/workspace-a/team/create', $triggers['New team']['#props']['href']);
    $attributes = (string) $triggers['New team']['#props']['attributes'];
    self::assertStringContainsString('hx-target="#bakers-overlay"', $attributes);
    self::assertStringContainsString('_wrapper_format=island_dialog', $attributes);
  }

  /**
   * Fixed route parameters overlay the screen's own raw parameters.
   */
  public function testRouteParametersOverlayTheScreen(): void {
    self::assertStringContainsString('/workspace-b/team/create', $this->triggers()['Overlaid']['#props']['href']);
  }

  /**
   * The query rule forwards listed keys, or all for `*`, never transport keys.
   */
  public function testQueryForwardsTheAllowedScreenKeys(): void {
    $this->enterScreen([
      'a' => '1',
      'b' => '2',
      'destination' => '/elsewhere',
      '_wrapper_format' => 'html',
      'ajax_page_state' => 'x',
    ]);
    $triggers = $this->triggers();
    self::assertSame(['destination'], array_keys($this->dialogQuery($triggers['New team'])));

    $listed = $this->dialogQuery($triggers['Listed query']);
    self::assertSame('1', $listed['a']);
    self::assertArrayNotHasKey('b', $listed);

    $all = $this->dialogQuery($triggers['All query']);
    self::assertSame(['a', 'b', 'destination'], array_keys($all));
    self::assertStringStartsWith('/workspace-a/members?', $all['destination']);
    self::assertStringNotContainsString('elsewhere', $all['destination']);
    self::assertStringNotContainsString('ajax_page_state', $all['destination']);
  }

  /**
   * A route-bound query key sends the converted id over a forwarded key.
   */
  public function testRouteQueryWinsWithTheConvertedId(): void {
    $this->enterScreen(['workspace' => '999']);
    self::assertSame((string) $this->workspace->id(), $this->dialogQuery($this->triggers()['Bound'])['workspace']);
  }

  /**
   * The trigger id becomes the trigger's element id.
   */
  public function testTriggerIdSetsTheElementId(): void {
    self::assertStringContainsString('id="team-add"', (string) $this->triggers()['With id']['#props']['attributes']);
  }

  /**
   * A denied dialog route offers nothing and varies by permissions and route.
   */
  public function testDeniedRouteAccessOffersNothing(): void {
    $denied = $this->createUser([]);
    self::assertNotFalse($denied);
    $this->setCurrentUser($denied);
    $build = $this->source()->getPropValue();
    self::assertSame([], $this->triggers($build));
    self::assertContains('user.permissions', $build['#cache']['contexts']);
    self::assertContains('route', $build['#cache']['contexts']);
  }

  /**
   * The `action` setting renders one action on any screen.
   */
  public function testTheActionSettingRendersOneActionAnywhere(): void {
    $triggers = $this->triggers($this->source(['action' => 'bb_create_action_test.elsewhere'])->getPropValue());
    self::assertSame(['Elsewhere'], array_keys($triggers));
    self::assertSame([], $this->triggers($this->source(['action' => 'no.such.action'])->getPropValue()));
  }

  /**
   * Renders the source on the current screen, keyed by trigger label.
   *
   * @param array<string, mixed>|null $build
   *   A build already made, or NULL to make one.
   *
   * @return array<string, array<string, mixed>>
   *   The triggers, by label.
   */
  private function triggers(?array $build = NULL): array {
    $build ??= $this->source()->getPropValue();
    $triggers = [];
    foreach ($build as $key => $child) {
      // The fixtures only: the shipped invite action shares this screen.
      if (str_starts_with((string) $key, 'bb_create_action_test.')) {
        $triggers[(string) $child['#props']['label']] = $child;
      }
    }
    return $triggers;
  }

  /**
   * The source with the given settings.
   *
   * @param array<string, mixed> $settings
   *   The source settings.
   */
  private function source(array $settings = []): SourcePluginBase {
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance('bb_create_action', SourcePluginBase::buildConfiguration('items', $schema, ['source' => $settings], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    return $source;
  }

  /**
   * The query of a trigger's plain address.
   *
   * @param array<string, mixed> $trigger
   *   The trigger.
   *
   * @return array<string, mixed>
   *   The parsed query.
   */
  private function dialogQuery(array $trigger): array {
    return Request::create($trigger['#props']['href'])->query->all();
  }

  /**
   * Puts the current request on the workspace Members screen.
   *
   * @param array<string, string> $query
   *   The screen's query.
   */
  private function enterScreen(array $query = []): void {
    $route = 'bb_core.bb_workspace.members';
    $request = Request::create('/workspace-a/members', 'GET', $query);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      '_route' => $route,
      '_route_object' => $this->container->get('router.route_provider')->getRouteByName($route),
      '_raw_variables' => new ParameterBag(['bb_workspace' => 'workspace-a']),
      'bb_workspace' => $this->workspace,
    ]);
    $this->container->get('request_stack')->push($request);
  }

}
