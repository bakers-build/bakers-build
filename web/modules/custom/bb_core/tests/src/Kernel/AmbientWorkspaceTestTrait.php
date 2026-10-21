<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\user\UserInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;

/**
 * The extra fixtures BB-351's kernel tests need on top of the world.
 *
 * All are needed by more than one test class — the resolver test, the
 * constraint test and the selection test all reach for them — so they are
 * written once here rather than three times. The two-workspace world itself
 * still comes from WorkspaceReadScopeTestTrait, which this trait pulls in so a
 * using class needs a single `use`.
 */
trait AmbientWorkspaceTestTrait {

  use WorkspaceReadScopeTestTrait;

  /**
   * Builds the two-workspace world and the real route table on top of it.
   *
   * The router rebuild is part of the fixture rather than an optional extra:
   * since the URL is the only workspace source, every one of these tests stands
   * on a REAL route, and a real route has to exist before it can be stood on.
   */
  protected function installAmbientWorkspaceWorld(): void {
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Creates one account holding an active membership in BOTH workspaces.
   *
   * Such an account is the only way to isolate D6's rule 2 from its rule 1:
   * with a membership on either side, a value from the other side passes the
   * membership rule and only the ambient rule can reject it.
   *
   * @return \Drupal\user\UserInterface
   *   The account.
   */
  protected function memberOfBothWorkspaces(): UserInterface {
    $account = $this->createAccount('member-of-both');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $account, ['member']);
    return $account;
  }

  /**
   * Pushes a request on the real add-form route of a workspace-bound type.
   *
   * The URL is the only workspace source there is, and only an ADD form is
   * create context — so the fixture has to be a real route, not a hand-built
   * one, or the narrowing could pass here and miss in production. The route is
   * read from the router by name, which is why every user of this trait
   * rebuilds the router in setUp.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $workspace
   *   The workspace the route parameter upcasts to.
   * @param string $entity_type_id
   *   The type whose add form to stand on. Any of the four behaves the same;
   *   the group form is the default because its fixtures are the cheapest.
   */
  protected function enterAddFormRouteWithWorkspace(ContentEntityInterface $workspace, string $entity_type_id = 'bb_group'): void {
    $this->enterRealRoute('entity.' . $entity_type_id . '.add_form', ['bb_workspace' => $workspace]);
  }

  /**
   * Pushes a request on a real route that carries a workspace but is no add.
   *
   * `entity.bb_group.edit_form` is deliberately a REAL route: the narrowing
   * under test is that a workspace-carrying route which is not an add form is
   * not create context, and every future workspace-carrying route (settings,
   * members, a report) is that same shape.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $workspace
   *   The workspace the route parameter upcasts to.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group the route's second parameter upcasts to.
   */
  protected function enterEditFormRouteWithWorkspace(ContentEntityInterface $workspace, ContentEntityInterface $group): void {
    $this->enterRealRoute('entity.bb_group.edit_form', [
      'bb_workspace' => $workspace,
      'bb_group' => $group,
    ]);
  }

  /**
   * Pushes a request whose route match is a real route with upcast parameters.
   *
   * @param string $route_name
   *   The route to stand on.
   * @param array<string, \Drupal\Core\Entity\ContentEntityInterface> $parameters
   *   The already-upcast parameter values, keyed by parameter name.
   */
  private function enterRealRoute(string $route_name, array $parameters): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName($route_name);
    self::assertInstanceOf(Route::class, $route);
    $path = $route->getPath();
    foreach ($parameters as $name => $value) {
      $path = str_replace('{' . $name . '}', (string) $value->id(), $path);
    }
    $request = Request::create($path);
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    foreach ($parameters as $name => $value) {
      $request->attributes->set($name, $value);
    }
    $stack = $this->container->get('request_stack');
    // KernelTestBase::tearDown() asks the stack's TOP request for its session,
    // so a fixture request pushed without one fails the teardown of an
    // otherwise passing test. Carrying the existing session over is also what a
    // real sub-request does.
    $current = $stack->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $stack->push($request);
  }

}
