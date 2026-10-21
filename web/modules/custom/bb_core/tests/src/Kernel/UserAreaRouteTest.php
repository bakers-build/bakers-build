<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\Entity\User;
use Symfony\Component\Yaml\Yaml;

/**
 * The user view and edit routes are distinct surfaces.
 *
 * Conductors and Machines are user-area rail items next to Account, not
 * local tasks.
 *
 * @group bb_core
 */
final class UserAreaRouteTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * The modules under test.
   *
   * @var array<int, string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'options', 'bb_core'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user']);
  }

  /**
   * The canonical route renders the view builder; the form lives on `/edit`.
   */
  public function testViewAndEditAreSeparateRoutes(): void {
    $provider = $this->container->get('router.route_provider');

    $canonical = $provider->getRouteByName('entity.user.canonical');
    self::assertNull($canonical->getDefault('_entity_form'));
    self::assertSame('user.full', $canonical->getDefault('_entity_view'));
    self::assertSame('/user/{user}', $canonical->getPath());

    $edit = $provider->getRouteByName('entity.user.edit_form');
    self::assertSame('user.default', $edit->getDefault('_entity_form'));
    self::assertSame('/user/{user}/edit', $edit->getPath());

    // Edit renders in the app shell, with core's access checks unchanged.
    self::assertFalse($edit->getOption('_admin_route'));
    self::assertSame('user.update', $edit->getRequirement('_entity_access'));
    self::assertSame('user.view', $canonical->getRequirement('_entity_access'));
    self::assertNull($edit->getRequirement('_bb_workspace_match'));
    self::assertTrue($provider->getRouteByName('entity.user.cancel_form')->getOption('_admin_route'));
  }

  /**
   * The user route keeps core's View and Edit; listings are rail items.
   */
  public function testUserRouteHasNoBbLocalTask(): void {
    $file = \Drupal::service('extension.list.module')->getPath('bb_core') . '/bb_core.links.task.yml';
    $definitions = Yaml::parseFile($file);

    $user_tabs = array_filter(
      $definitions,
      static fn (array $tab): bool => ($tab['base_route'] ?? NULL) === 'entity.user.canonical',
    );

    self::assertSame([], $user_tabs);
    self::assertArrayNotHasKey('view.conductors.user_list', $definitions);
    self::assertArrayNotHasKey('view.machines.user_list', $definitions);
    self::assertArrayNotHasKey('bb_core.user.profile', $definitions);
    self::assertArrayNotHasKey('view.user_connections.page_1', $definitions);
  }

  /**
   * The third-party social auth task is dropped at local-task discovery.
   *
   * A wrong plugin id would unset nothing and put the tab back, silently.
   */
  public function testSocialAuthTaskIsRemovedAtDiscovery(): void {
    $local_tasks = [
      'entity.user.canonical' => ['base_route' => 'entity.user.canonical'],
      'social_auth.user.social_auth_profiles_task' => ['base_route' => 'entity.user.canonical'],
    ];

    \Drupal::moduleHandler()->alter('local_tasks', $local_tasks);

    self::assertArrayNotHasKey('social_auth.user.social_auth_profiles_task', $local_tasks);
    self::assertArrayHasKey('entity.user.canonical', $local_tasks);
  }

  /**
   * Profile save is a full document POST, not an island-boosted fragment.
   */
  public function testUserFormOptsOutOfIslandBoost(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $this->setCurrentUser($owner);
    $form = $this->container->get('entity.form_builder')->getForm($owner, 'default');
    self::assertSame('false', $form['#attributes']['data-hx-boost'] ?? NULL);
  }

}
