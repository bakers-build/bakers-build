<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Tests the shared settings form display (BB-499).
 *
 * `bb_workspace`, `bb_team` and `bb_project` share one form display
 * between their create dialog and their settings screen.
 */
#[Group('bb_core')]
final class SettingsFormDisplayTest extends KernelTestBase {

  use ShippedImageConfigTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop', 'bb_image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_workspace',
      'bb_team', 'bb_environment', 'bb_ticket', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    $this->installShippedFormDisplays();
  }

  /**
   * Every project, group and workspace form crops its image where uploaded.
   */
  public function testImageFormsUseTheSquareCropWidget(): void {
    foreach ([
      'bb_project.bb_project.settings',
      'bb_group.bb_group.create',
      'bb_group.bb_group.settings',
      'bb_workspace.bb_workspace.settings',
    ] as $id) {
      self::assertSame('bb_square_image', self::orderedComponents($id)['image']['type'] ?? NULL, "$id crops its image.");
    }
  }

  /**
   * One shared `settings` display per entity type, no leftover `create`.
   */
  public function testCreateAndSettingsShareOneDisplay(): void {
    foreach (['bb_workspace', 'bb_team', 'bb_project'] as $type) {
      $display = EntityFormDisplay::load($type . '.' . $type . '.settings');
      self::assertNotNull($display, "$type ships a settings form display");
      self::assertNull(
        EntityFormDisplay::load($type . '.' . $type . '.create'),
        "$type ships no leftover create form display"
      );
    }
    self::assertSame(
      ['group_id', 'teams', 'name', 'description', 'image', 'repository', 'owner_user_id', 'env_vars'],
      array_keys(self::orderedComponents('bb_project.bb_project.settings')),
    );
    self::assertSame(['name', 'description', 'image'], array_keys(self::orderedComponents('bb_workspace.bb_workspace.settings')));
    self::assertSame(['name'], array_keys(self::orderedComponents('bb_team.bb_team.settings')));
    self::assertSame(['name', 'description', 'image'], array_keys(self::orderedComponents('bb_group.bb_group.settings')));
    self::assertSame(['name', 'description', 'image'], array_keys(self::orderedComponents('bb_group.bb_group.create')));
  }

  /**
   * The Settings routes render the entity's own form, no controller.
   */
  public function testSettingsRoutesRenderTheEntityForm(): void {
    $routes = [
      'bb_core.bb_workspace.settings' => 'bb_workspace.settings',
      'bb_core.bb_project.settings'   => 'bb_project.settings',
    ];
    foreach ($routes as $name => $entity_form) {
      $route = \Drupal::service('router.route_provider')->getRouteByName($name);
      self::assertSame($entity_form, $route->getDefault('_entity_form'));
      self::assertNull($route->getDefault('_controller'), "$name renders no controller");
    }
  }

  /**
   * The `settings` form carries the tab-body marker the browser suite finds.
   */
  public function testSettingsFormCarriesTheTabBodyMarker(): void {
    $team = $this->createTeam();
    $form = \Drupal::service('entity.form_builder')->getForm($team, 'settings');
    self::assertSame('settings', $form['#attributes']['data-bakers-tab-body']);
    // Settings save on an explicit, visible Save through a native POST.
    self::assertArrayNotHasKey('data-form-save', $form['#attributes']);
    self::assertNotContains('bb_core/form_save', $form['#attached']['library'] ?? []);
    self::assertArrayNotHasKey('status', $form);
    // The shell places no messages region; the form renders its own.
    self::assertSame('status_messages', $form['messages']['#type']);
    self::assertFalse($form['actions']['submit']['#attributes']['hidden'] ?? FALSE);
    self::assertArrayNotHasKey('delete', $form['actions']);
    self::assertSame('false', $form['#attributes']['data-hx-boost']);
  }

  /**
   * A Settings form reached by an htmx tab click posts without transport keys.
   *
   * Core's `htmx-assets.js` puts `ajax_page_state[...]` on every htmx GET.
   * Copied into the native POST target, the landing page would treat every
   * library as already loaded and arrive with no CSS or JS.
   */
  public function testSettingsFormActionDropsHtmxTransportKeys(): void {
    $team = $this->createTeam();
    $request = Request::create('/settings', 'GET', [
      'keep' => '1',
      'ajax_page_state' => ['theme' => 'bb_theme', 'libraries' => 'system/base'],
      '_wrapper_format' => 'drupal_htmx',
      '_triggering_element_name' => 'op',
      '_triggering_element_value' => 'Save',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    // The form action is built from the main request, so it replaces the stack.
    $stack = $this->container->get('request_stack');
    while ($stack->pop()) {
      continue;
    }
    $stack->push($request);

    $form = \Drupal::service('entity.form_builder')->getForm($team, 'settings');
    $html = (string) \Drupal::service('renderer')->renderInIsolation($form);
    self::assertSame(1, preg_match('/<form[^>]* action="([^"]*)"/', $html, $match));
    parse_str((string) parse_url(html_entity_decode($match[1]), PHP_URL_QUERY), $query);
    self::assertSame(['keep' => '1'], $query);
  }

  /**
   * Loads a display and returns its components sorted by weight.
   *
   * @return array<string, array<string, mixed>>
   *   The display's components, keyed by field name, sorted by weight.
   */
  private static function orderedComponents(string $id): array {
    $display = EntityFormDisplay::load($id);
    self::assertNotNull($display, "$id exists");
    $components = $display->getComponents();
    uasort($components, static fn (array $a, array $b): int => $a['weight'] <=> $b['weight']);
    return $components;
  }

  /**
   * Creates a saved team, below a fresh workspace.
   */
  private function createTeam(): ContentEntityInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')->create(['name' => 'settings-marker', 'slug' => 'settings-marker']);
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')->create(['name' => 'settings-marker-team', 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(ContentEntityInterface::class, $team);
    $team->save();
    return $team;
  }

}
