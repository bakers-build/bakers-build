<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\Request;

/**
 * Makes a route the current request the way a browser request would.
 *
 * The path is generated outbound and matched by the real router, which runs
 * the inbound path processors, so the route match carries the same upcast and
 * raw parameters as a live request. Setting request attributes by hand leaves
 * the raw parameters empty, which hid a broken active trail from these tests.
 */
trait RailRequestTrait {

  /**
   * Pushes a request for a route onto the request stack.
   *
   * @param string $route_name
   *   The route to visit.
   * @param array<string, int|string> $parameters
   *   Raw route parameters, e.g. a workspace slug or an entity id.
   */
  protected function visit(string $route_name, array $parameters = []): void {
    $path = Url::fromRoute($route_name, $parameters)->toString();
    $request = Request::create($path);
    // Carry the harness's session over: reading the current user off the
    // request would otherwise throw SessionNotFoundException.
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    // The route provider runs the inbound path processors itself.
    $request->attributes->add($this->container->get('router.no_access_checks')->matchRequest(Request::create($path)));
    $this->container->get('request_stack')->push($request);
    self::assertSame($route_name, $this->container->get('current_route_match')->getRouteName());
  }

}
