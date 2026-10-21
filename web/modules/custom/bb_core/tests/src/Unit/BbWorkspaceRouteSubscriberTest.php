<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\Core\Cache\Context\CacheContextsManager;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Drupal\Core\Access\AccessResultForbidden;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Routing\RouteBuildEvent;
use Drupal\bb_core\Access\BbWorkspaceAccessCheck;
use Drupal\bb_core\Routing\BbWorkspaceRouteSubscriber;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/**
 * Error presentation preserves the existing workspace access decisions.
 */
#[Group('bb_core')]
final class BbWorkspaceRouteSubscriberTest extends UnitTestCase {

  /**
   * Core keeps the first forbidden reason when combining route requirements.
   */
  public function testExistingEntityRefusalKeepsItsPrecedence(): void {
    $route = new Route('/_workspace/{bb_workspace}/ticket/{bb_ticket}', [], ['_entity_access' => 'bb_ticket.view']);
    $collection = new RouteCollection();
    $collection->add('entity.bb_ticket.canonical', $route);
    (new BbWorkspaceRouteSubscriber())->onAlterRoutes(new RouteBuildEvent($collection));
    $result = AccessResult::allowed();
    foreach ($route->getRequirements() as $key => $value) {
      if ($key === '_entity_access') {
        self::assertSame('bb_ticket.view', $value);
        $result = $result->andIf(AccessResult::forbidden());
      }
      if ($key === '_bb_workspace_match') {
        $result = $result->andIf(AccessResult::forbidden(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON));
      }
    }
    self::assertInstanceOf(AccessResultForbidden::class, $result);
    self::assertTrue($result->isForbidden());
    self::assertSame('', $result->getReason());
  }

  /**
   * Anonymous workspace failures retain their not-found marker.
   */
  public function testAnonymousWorkspaceFailureRetainsItsNotFoundMarker(): void {
    $container = new ContainerBuilder();
    $cache_contexts = $this->createMock(CacheContextsManager::class);
    $cache_contexts->method('assertValidTokens')->willReturn(TRUE);
    $container->set('cache_contexts_manager', $cache_contexts);
    \Drupal::setContainer($container);
    $check = new BbWorkspaceAccessCheck(
      $this->createMock(WorkspaceResolverInterface::class),
      $this->createMock(BbWorkspaceReadScopeInterface::class),
    );
    $account = $this->createMock(AccountInterface::class);
    $account->method('isAnonymous')->willReturn(TRUE);
    $result = $check->access($this->createMock(RouteMatchInterface::class), $account);
    self::assertInstanceOf(AccessResultForbidden::class, $result);
    self::assertTrue($result->isForbidden());
    self::assertSame(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON, $result->getReason());
  }

}
