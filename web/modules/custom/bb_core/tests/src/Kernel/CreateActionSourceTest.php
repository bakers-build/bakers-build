<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
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
 * The one configurable create-action source and each of its settings.
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
    'display_builder_views', 'bb_core',
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
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create([
      'name' => 'A',
      'slug' => 'workspace-a',
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $this->container->get('router.builder')->rebuild();
    $this->enterScreen('bb_core.bb_workspace.members');
  }

  /**
   * The label is the dialog route's title; the `label` setting overrides it.
   */
  public function testLabelIsTheRouteTitleUnlessSet(): void {
    $build = $this->build(['route' => 'entity.bb_team.create_form']);
    self::assertSame('bb_theme:button', $build['#component']);
    self::assertSame('New team', $build['#props']['label']);
    self::assertStringContainsString('/workspace-a/team/create', $build['#props']['href']);

    self::assertSame('Add a team', $this->build(['route' => 'entity.bb_team.create_form', 'label' => 'Add a team'])['#props']['label']);
  }

  /**
   * Screens list route names; a trailing `*` matches a prefix, empty is all.
   */
  public function testScreensKeepTheTriggerOffOtherRoutes(): void {
    $route = ['route' => 'entity.bb_team.create_form'];
    self::assertArrayNotHasKey('#component', $this->build($route + ['screens' => ['bb_core.bb_team.members']]));
    self::assertArrayHasKey('#component', $this->build($route + ['screens' => ['bb_core.bb_workspace.members']]));
    self::assertArrayHasKey('#component', $this->build($route + ['screens' => ['bb_core.bb_workspace.*']]));
    self::assertArrayNotHasKey('#component', $this->build($route + ['screens' => ['bb_core.bb_workspace']]));
    self::assertArrayHasKey('#component', $this->build($route + ['screens' => []]));
  }

  /**
   * A dialog path variable the screen cannot fill offers no trigger.
   */
  public function testAnUnfilledPathVariableOffersNothing(): void {
    $build = $this->build(['route' => 'bb_core.bb_team.member_add']);
    self::assertArrayNotHasKey('#component', $build);
    self::assertContains('route', $build['#cache']['contexts']);
  }

  /**
   * Fixed route parameters overlay the screen's own raw parameters.
   */
  public function testRouteParametersOverlayTheScreen(): void {
    $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create([
      'name' => 'B',
      'slug' => 'workspace-b',
    ])->save();
    $build = $this->build([
      'route' => 'entity.bb_team.create_form',
      'route_parameters' => ['bb_workspace' => 'workspace-b'],
    ]);
    self::assertStringContainsString('/workspace-b/team/create', $build['#props']['href']);
  }

  /**
   * The query setting forwards listed keys, or all for `*`, never transport.
   */
  public function testQueryForwardsTheAllowedScreenKeys(): void {
    $this->enterScreen('bb_core.bb_workspace.members', [
      'a' => '1',
      'b' => '2',
      'destination' => '/elsewhere',
      '_wrapper_format' => 'html',
      'ajax_page_state' => 'x',
    ]);
    $none = $this->dialogQuery($this->build(['route' => 'entity.bb_team.create_form']));
    self::assertSame(['destination'], array_keys($none));

    $listed = $this->dialogQuery($this->build(['route' => 'entity.bb_team.create_form', 'query' => ['a']]));
    self::assertSame('1', $listed['a']);
    self::assertArrayNotHasKey('b', $listed);

    $all = $this->dialogQuery($this->build(['route' => 'entity.bb_team.create_form', 'query' => ['*']]));
    self::assertSame(['a', 'b', 'destination'], array_keys($all));
    self::assertStringStartsWith('/workspace-a/members?', $all['destination']);
    self::assertStringNotContainsString('elsewhere', $all['destination']);
    self::assertStringNotContainsString('ajax_page_state', $all['destination']);
  }

  /**
   * A route-bound query key sends the converted id over a forwarded key.
   */
  public function testRouteQueryWinsWithTheConvertedId(): void {
    $this->enterScreen('bb_core.bb_workspace.members', ['workspace' => '999']);
    $query = $this->dialogQuery($this->build([
      'route' => 'entity.bb_team.create_form',
      'query' => ['*'],
      'route_query' => ['workspace' => 'bb_workspace'],
    ]));
    self::assertSame((string) $this->workspace->id(), $query['workspace']);
  }

  /**
   * The trigger id setting becomes the trigger's element id.
   */
  public function testTriggerIdSetsTheElementId(): void {
    $build = $this->build(['route' => 'entity.bb_team.create_form', 'trigger_id' => 'team-add']);
    self::assertStringContainsString('id="team-add"', (string) $build['#props']['attributes']);
  }

  /**
   * A denied dialog route offers nothing and varies by permissions and route.
   */
  public function testDeniedRouteAccessOffersNothing(): void {
    $denied = $this->createUser([]);
    self::assertNotFalse($denied);
    $this->setCurrentUser($denied);
    $build = $this->build(['route' => 'entity.bb_team.create_form']);
    self::assertArrayNotHasKey('#component', $build);
    self::assertContains('user.permissions', $build['#cache']['contexts']);
    self::assertContains('route', $build['#cache']['contexts']);
  }

  /**
   * A route titled only by a callback, with no label set, offers nothing.
   *
   * The callback would run without the dialog's own request; an unlabelled
   * icon button would have no accessible name.
   */
  public function testRouteWithoutStaticTitleNeedsLabel(): void {
    self::assertArrayNotHasKey('#component', $this->build(['route' => 'entity.bb_workspace.delete_form']));
    self::assertSame('Remove', $this->build(['route' => 'entity.bb_workspace.delete_form', 'label' => 'Remove'])['#props']['label']);
  }

  /**
   * The settings form keeps the settings it shows no widget for.
   */
  public function testTheSettingsFormKeepsConfigOnlySettings(): void {
    $settings = [
      'route' => 'entity.bb_ticket.create_form',
      'screens' => ['view.tickets.*'],
      'route_parameters' => ['a' => 'b'],
      'query' => ['*'],
      'route_query' => ['project' => 'bb_project'],
    ];
    $form = $this->source($settings)->settingsForm([], new FormState());
    foreach (['screens', 'route_parameters', 'query', 'route_query'] as $key) {
      self::assertSame('value', $form[$key]['#type']);
      self::assertSame($settings[$key], $form[$key]['#value']);
    }
    self::assertSame('textfield', $form['route']['#type']);
  }

  /**
   * An empty or unknown route offers nothing and throws nothing.
   */
  public function testMissingRouteOffersNothing(): void {
    self::assertArrayNotHasKey('#component', $this->build([]));
    self::assertArrayNotHasKey('#component', $this->build(['route' => 'no.such.route']));
  }

  /**
   * Renders the source with the given settings on the current screen.
   *
   * @param array<string, mixed> $settings
   *   The source settings.
   *
   * @return array<string, mixed>
   *   The prop value.
   */
  private function build(array $settings): array {
    return $this->source($settings)->getPropValue();
  }

  /**
   * The source with the given settings.
   *
   * @param array<string, mixed> $settings
   *   The source settings.
   */
  private function source(array $settings): SourcePluginBase {
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance('bb_create_action', SourcePluginBase::buildConfiguration('items', $schema, ['source' => $settings], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    return $source;
  }

  /**
   * The query of the trigger's plain address.
   *
   * @param array<string, mixed> $build
   *   The trigger.
   *
   * @return array<string, mixed>
   *   The parsed query.
   */
  private function dialogQuery(array $build): array {
    return Request::create($build['#props']['href'])->query->all();
  }

  /**
   * Puts the current request on a workspace screen.
   *
   * @param string $route
   *   The screen's route name.
   * @param array<string, string> $query
   *   The screen's query.
   */
  private function enterScreen(string $route, array $query = []): void {
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
