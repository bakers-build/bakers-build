<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Core\Routing\RouteBuildEvent;
use Drupal\bb_core\Routing\BbErrorPageRouteSubscriber;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/**
 * Error presentation must leave core routing and access semantics intact.
 */
#[Group('bb_core')]
final class BbErrorPageRouteSubscriberTest extends UnitTestCase {

  /**
   * Only the two HTML error route defaults change.
   */
  public function testOnlyErrorPresentationChanges(): void {
    $collection = new RouteCollection();
    foreach (['system.403', 'system.404', 'user.login', 'jsonapi.test'] as $name) {
      $collection->add($name, new Route('/' . $name, ['_controller' => 'original', '_title' => 'Original'], ['_access' => 'TRUE'], ['_admin_route' => FALSE]));
    }
    $before = clone $collection->get('user.login');
    (new BbErrorPageRouteSubscriber())->onAlterRoutes(new RouteBuildEvent($collection));
    foreach ([403 => 'Access denied', 404 => 'Page not found'] as $status => $title) {
      $route = $collection->get('system.' . $status);
      self::assertSame('\\Drupal\\bb_core\\Controller\\BbErrorPageController::on' . $status, $route->getDefault('_controller'));
      self::assertSame($status . ' — ' . $title, $route->getDefault('_title'));
      self::assertSame(['_access' => 'TRUE'], $route->getRequirements());
      self::assertFalse($route->getOption('_admin_route'));
      self::assertSame('/system.' . $status, $route->getPath());
    }
    self::assertEquals($before, $collection->get('user.login'));
    self::assertSame('original', $collection->get('jsonapi.test')->getDefault('_controller'));
    (new BbErrorPageRouteSubscriber())->onAlterRoutes(new RouteBuildEvent(new RouteCollection()));
  }

}
