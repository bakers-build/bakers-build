<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandInterface;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests the responder.
 *
 * Self and peer fragments, event dispatch, headers, cache metadata, and
 * acceptance criterion 10.
 */
#[Group('island')]
final class IslandResponderTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'island', 'island_test'];

  /**
   * Returns the island responder service.
   */
  private function responder(): IslandResponder {
    return $this->container->get('island.responder');
  }

  /**
   * Returns the fixture host provider.
   */
  private function host(): IslandContextProviderInterface {
    return $this->container->get('island_test.host');
  }

  /**
   * Creates a fixture island wired to the fixture host.
   */
  private function island(string $id): IslandInterface {
    $host = $this->host();
    $config = $host->getIslandConfiguration($id);
    $config['contexts']['host'] = $host;
    $island = $this->container->get('plugin.manager.island')->createInstance($id, $config);
    $this->assertInstanceOf(IslandInterface::class, $island);
    return $island;
  }

  /**
   * {@inheritdoc}
   */
  public function testRebuildSelfAndPeerOob(): void {
    $triggering = $this->island('task_list');
    $response = IslandResponse::make()->rebuildSelf()->rebuild(['task_count']);
    $http = $this->responder()->toResponse($response, $triggering, $this->host());
    $html = (string) $http->getContent();
    // Triggering island: main fragment, no oob attribute.
    $this->assertStringContainsString('id="island-tasks-task_list"', $html);
    // Peer: OOB fragment with its own stable id.
    $this->assertMatchesRegularExpression('/id="island-tasks-task_count"[^>]*hx-swap-oob="outerHTML"/', $html);
    $this->assertStringContainsString('list:3', $html);
    $this->assertStringContainsString('count:3', $html);
  }

  /**
   * {@inheritdoc}
   */
  public function testDispatchFanOutAndNullSkip(): void {
    $triggering = $this->island('task_list');
    $response = IslandResponse::make()->dispatch('tasks.changed', ['count' => 7]);
    $http = $this->responder()->toResponse($response, $triggering, $this->host());
    $html = (string) $http->getContent();
    // Subscribed peer re-rendered OOB.
    $this->assertStringContainsString('count:7', $html);
    $this->assertMatchesRegularExpression('/id="island-tasks-task_count"[^>]*hx-swap-oob="outerHTML"/', $html);
    // NULL-returning subscriber emits nothing.
    $this->assertStringNotContainsString('island-tasks-quiet', $html);
    // The triggering island is not re-rendered by its own dispatch.
    $this->assertStringNotContainsString('island-tasks-task_list', $html);
  }

  /**
   * Explicit rebuild and event subscription produce one replacement per target.
   */
  public function testExplicitAndSubscribedTargetsAreDeduplicated(): void {
    $response = IslandResponse::make()->rebuildSelf()->rebuild(['task_count'])
      ->dispatch('tasks.changed', ['count' => 7]);
    $http = $this->responder()->toResponse($response, $this->island('task_list'), $this->host());
    preg_match_all('/id="(island-[^"]+)"/', (string) $http->getContent(), $matches);
    self::assertSame(['island-tasks-task_list', 'island-tasks-task_count'], $matches[1]);
  }

  /**
   * Explicit peer requests cannot bypass the host's current view access.
   */
  public function testDeniedPeerIsNotRendered(): void {
    $response = IslandResponse::make()->rebuildSelf()->rebuild(['quiet']);
    $http = $this->responder()->toResponse($response, $this->island('task_list'), $this->host());
    preg_match_all('/id="(island-[^"]+)"/', (string) $http->getContent(), $matches);
    self::assertSame(['island-tasks-task_list'], $matches[1]);
  }

  /**
   * A discovered plugin outside the host cannot be requested as a placement.
   */
  public function testForeignPeerIsNotConstructed(): void {
    $response = IslandResponse::make()->rebuildSelf()->rebuild(['test_island']);
    $http = $this->responder()->toResponse($response, $this->island('task_list'), $this->host());
    preg_match_all('/id="(island-[^"]+)"/', (string) $http->getContent(), $matches);
    self::assertSame(['island-tasks-task_list'], $matches[1]);
  }

  /**
   * {@inheritdoc}
   */
  public function testHeaders(): void {
    $triggering = $this->island('task_list');
    $response = IslandResponse::make()
      ->triggerClientEvent('drawer:close')
      ->location(Url::fromRoute('island_test.page'));
    $http = $this->responder()->toResponse($response, $triggering, $this->host());
    $this->assertSame('{"drawer:close":[]}', $http->headers->get('HX-Trigger'));
    $this->assertStringContainsString('/island-test', (string) $http->headers->get('HX-Location'));
  }

  /**
   * A mutation round trip rebuilds exactly the islands its response names.
   *
   * Acceptance criterion 10. The host registers three islands and the
   * IslandResponse names two of them; a response that rebuilt the host's
   * islands rather than the named ones would still look correct to any
   * assertion made about a single fragment.
   *
   * So the assertion is the whole ordered SET of rebuilt ids, not a presence
   * and not an absence. A presence passes against a response that rebuilt too
   * much; an absence passes against an empty response. Only the exhaustive set
   * fails in both directions — an island too few and an island too many are
   * each a failure, and the order is the order the IslandResponse named.
   */
  public function testMutationRebuildsExactlyTheNamedIslands(): void {
    $triggering = $this->island('task_list');
    $response = IslandResponse::make()->rebuildSelf()->rebuild(['task_count']);
    $html = (string) $this->responder()->toResponse($response, $triggering, $this->host())->getContent();

    preg_match_all('/id="(island-[^"]+)"/', $html, $matches);
    $this->assertSame(['island-tasks-task_list', 'island-tasks-task_count'], $matches[1]);
  }

  /**
   * {@inheritdoc}
   */
  public function testCacheMetadataBubbles(): void {
    $triggering = $this->island('task_list');
    $response = IslandResponse::make()->rebuildSelf();
    $http = $this->responder()->toResponse($response, $triggering, $this->host());
    // The fixture island tags its build with 'island_test:list'. The
    // X-Drupal-Cache-Tags header itself is only emitted by core's
    // FinishResponseSubscriber in a full request cycle; the bubbling this
    // test guards is the cacheable metadata carried by the response.
    $this->assertContains('island_test:list', $http->getCacheableMetadata()->getCacheTags());
  }

}
