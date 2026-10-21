<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Routing\RouteObjectInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;

/**
 * Makes a routed request current, as conditions read it.
 */
trait ProfileRequestTrait {

  /**
   * Pushes a request for a path and route onto the request stack.
   */
  protected function enterPath(string $path, string $route = 'island_test.page', string $method = 'GET'): Request {
    $request = Request::create($path, $method);
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current?->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, new Route($path));
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
    // Core's context repository memoizes per request; tests replay many, so
    // every service holding it starts fresh.
    $services = [
      'context.repository',
      'island.condition_evaluator',
      'island.profile_selector',
      'island.profile_renderer',
      'island.host_resolver',
      'island.action_subscriber',
    ];
    foreach ($services as $service) {
      $this->container->set($service, NULL);
    }
    return $request;
  }

  /**
   * A core request_path condition collection for the given pages.
   *
   * @return array<string, array<string, mixed>>
   *   Condition plugin configurations.
   */
  protected static function pages(string $pages, bool $negate = FALSE): array {
    return ['request_path' => ['id' => 'request_path', 'negate' => $negate, 'pages' => $pages]];
  }

}
