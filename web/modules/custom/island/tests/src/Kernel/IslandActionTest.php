<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\island\IslandInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Tests island action links: they post to the page they are shown on.
 *
 * Link shape, CSRF, access delegation, fragments.
 */
#[Group('island')]
final class IslandActionTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'user', 'island', 'island_test'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system']);
    $this->container->get('theme_installer')->install(['stark']);
    $this->container->get('config.factory')->getEditable('system.theme')->set('default', 'stark')->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The fixture's delete link, built while the given page is current.
   *
   * @return array{url: string, vals: array<string, string>, contexts: string[]}
   *   The URL the link posts to, the values it posts and its cache contexts.
   */
  private function deleteLink(string $page): array {
    $request = Request::create($page);
    $request->setSession($this->container->get('session'));
    $this->container->get('request_stack')->push($request);
    $host = $this->container->get('island_test.host');
    $config = $host->getIslandConfiguration('task_list');
    $config['contexts']['host'] = $host;
    $island = $this->container->get('plugin.manager.island')->createInstance('task_list', $config);
    $this->assertInstanceOf(IslandInterface::class, $island);
    $link = $island->build($host->getIslandData('task_list'))['content']['actions']['delete'];
    $this->container->get('request_stack')->pop();
    return [
      'url' => $link['#url']->toString(),
      'vals' => json_decode((string) $link['#attributes']['data-hx-vals'], TRUE),
      'contexts' => $link['#cache']['contexts'] ?? [],
    ];
  }

  /**
   * Posts island values to a page through the real kernel.
   */
  private function post(string $url, array $vals): Response {
    $request = Request::create($url, 'POST', $vals);
    $request->setSession($this->container->get('session'));
    return $this->container->get('http_kernel')->handle($request);
  }

  /**
   * The link posts to its own page, query included, and names its island.
   */
  public function testLinkPostsToItsPage(): void {
    $link = $this->deleteLink('/island-test?workspace=abc');
    $this->assertSame('/island-test?workspace=abc', $link['url']);
    $this->assertSame('task_list', $link['vals']['_island']);
    $this->assertSame('delete', $link['vals']['_island_action']);
    $this->assertSame('tasks', $link['vals']['_island_host']);
    $this->assertNotEmpty($link['vals']['_island_token']);
    $this->assertContains('url.path', $link['contexts']);
    $this->assertContains('url.query_args', $link['contexts']);
  }

  /**
   * A percent-encoded page path is linked as is, not encoded twice.
   */
  public function testLinkKeepsAnEncodedPath(): void {
    $this->assertSame('/island-test/caf%C3%A9', $this->deleteLink('/island-test/caf%C3%A9')['url']);
  }

  /**
   * The page route's own access applies to an action posted to it.
   */
  public function testActionOnDeniedPageIsRefused(): void {
    $link = $this->deleteLink('/island-test');
    $response = $this->post('/admin', $link['vals']);
    $this->assertSame(403, $response->getStatusCode());
    $this->assertStringNotContainsString('id="island-tasks-task_list"', (string) $response->getContent());
  }

  /**
   * The page answers the action with fragments; its controller never runs.
   */
  public function testActionAnswersWithFragments(): void {
    $link = $this->deleteLink('/island-test');
    $response = $this->post($link['url'], $link['vals']);
    $html = (string) $response->getContent();
    $this->assertSame(200, $response->getStatusCode());
    $this->assertStringContainsString('id="island-tasks-task_list"', $html);
    $this->assertMatchesRegularExpression('/id="island-tasks-task_count"[^>]*hx-swap-oob="outerHTML"/', $html);
    $this->assertStringContainsString('count:2', $html);
    $this->assertStringNotContainsString('>ok<', $html, 'The page controller does not run for an action.');
  }

  /**
   * A token is bound to its island and action, and required.
   */
  public function testInvalidTokenIsRejected(): void {
    $link = $this->deleteLink('/island-test');
    $this->assertSame(403, $this->post($link['url'], ['_island_token' => 'bogus'] + $link['vals'])->getStatusCode());
    $vals = $link['vals'];
    unset($vals['_island_token']);
    $this->assertSame(403, $this->post($link['url'], $vals)->getStatusCode());
  }

  /**
   * Access delegates to the plugin and to the host; misses are not a 500.
   *
   * An unknown action, an unknown host, an island id with no plugin and an id
   * the host does not claim are all refused alike.
   */
  public function testAccessDelegatesToPluginAndHost(): void {
    $link = $this->deleteLink('/island-test');
    $token = $this->container->get('csrf_token');
    $refused = [
      ['_island_action' => 'unknown_action'],
      ['_island_host' => 'no_such_host'],
      ['_island' => 'no_such_plugin'],
      ['_island' => 'messages'],
    ];
    foreach ($refused as $override) {
      $vals = $override + $link['vals'];
      $vals['_island_token'] = $token->get(sprintf('island/action/%s/%s', $vals['_island'], $vals['_island_action']));
      $this->assertSame(403, $this->post($link['url'], $vals)->getStatusCode(), (string) json_encode($override));
    }
  }

  /**
   * An ordinary request to the page is untouched.
   */
  public function testOrdinaryRequestsReachThePage(): void {
    $this->assertStringContainsString('ok', (string) $this->post('/island-test', ['foo' => 'bar'])->getContent());
  }

}
