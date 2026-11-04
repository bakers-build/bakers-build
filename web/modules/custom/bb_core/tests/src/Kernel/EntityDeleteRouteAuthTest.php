<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Web delete routes accept a browser session only, never a bearer token.
 *
 * Basic auth and OAuth2 are non-global providers, so a route that does not
 * list them in `_auth` rejects such a request with 403.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityDeleteRouteAuthTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'views', 'bb_core',
  ];

  /**
   * No delete form route opts into a machine authentication provider.
   */
  public function testDeleteRoutesAreCookieOnly(): void {
    $this->container->get('router.builder')->rebuild();
    $routes = $this->container->get('router.route_provider');
    $checked = [];
    foreach ($this->container->get('entity_type.manager')->getDefinitions() as $id => $definition) {
      if (!str_starts_with($id, 'bb_') || !$definition->hasLinkTemplate('delete-form')) {
        continue;
      }
      $route = $routes->getRouteByName("entity.$id.delete_form");
      $auth = (array) ($route->getOption('_auth') ?? []);
      self::assertSame([], array_intersect($auth, ['basic_auth', 'oauth2']), "$id delete form accepts no bearer");
      $checked[] = $id;
    }
    // Guards the loop against silently checking nothing.
    self::assertContains('bb_term', $checked);
    self::assertContains('bb_invite', $checked);
    self::assertContains('bb_project', $checked);
  }

}
