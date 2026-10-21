<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The three API-key routes accept only a cookie session, never a bearer key.
 *
 * A bearer-authenticated managed key must not be able to list, create or
 * revoke keys — including itself — with the key it carries. Route-level
 * `_auth` restriction is what the authentication subscriber consults before
 * any access check runs.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyRouteAuthTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'state_machine',
    'consumers', 'simple_oauth', 'views', 'path_alias', 'bb_core', 'bb_api_key',
  ];

  /**
   * Each of the three owner-only routes restricts `_auth` to `cookie` only.
   */
  public function testRoutesAcceptOnlyCookieAuthentication(): void {
    $this->installEntitySchema('user');
    $this->installEntitySchema('consumer');
    $data = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/views.view.bb_api_keys.yml'));
    unset($data['display']['page']['display_options']['display_extenders']);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();

    $routeProvider = $this->container->get('router.route_provider');
    foreach (['bb_api_key.add', 'bb_api_key.delete', 'view.bb_api_keys.page'] as $routeName) {
      $route = $routeProvider->getRouteByName($routeName);
      self::assertSame(
        ['cookie'],
        $route->getOption('_auth'),
        "$routeName must restrict authentication to a cookie session, not a bearer token",
      );
    }
  }

}
