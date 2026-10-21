<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\KernelTests\KernelTestBase;

/**
 * Core's password form is not a product door.
 *
 * @group bb_login
 */
final class UserPassRedirectTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'options', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['user']);
  }

  /**
   * Visiting the retired password path sends the visitor to the one login door.
   */
  public function testPasswordRouteRedirectsToLogin(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName('user.pass');
    self::assertStringContainsString(
      'redirectPasswordToLogin',
      (string) $route->getDefault('_controller'),
    );
  }

}
