<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\PageCache\ChainRequestPolicy;
use Drupal\Core\PageCache\RequestPolicyInterface;
use Drupal\island\PageCache\IslandPageCacheRequestPolicy;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;

/**
 * Tests that a boosted island request bypasses the internal page cache (D6).
 *
 * This is twenty lines standing between the design and a poisoned anonymous
 * site, and both directions of the hazard are real. PageCache keys on scheme,
 * host and request URI plus the request format — no header, no Vary — so a
 * boosted GET would STORE an island fragment under the whole page's url and
 * the next plain visitor would be served the fragment as the page; and a
 * boosted GET against an already-cached page would be ANSWERED by the
 * middleware before the kernel runs, so the subscriber never fires and htmx
 * swaps the entire page into an island.
 *
 * `setMaxAge(0)` is not the fix. PageCache's own source says the page cache
 * ignores max age, and it accepts any CacheableResponseInterface — which is
 * exactly what the responder returns.
 *
 * The dynamic page cache has the identical hazard and was not in the design:
 * it stores per-page cache-context variations, and a page's own variation does
 * not vary on any htmx header, so a boosted request matches it and is answered
 * before kernel.view runs. One policy, two tags.
 */
#[Group('island')]
final class IslandPageCachePolicyTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'page_cache', 'dynamic_page_cache', 'island'];

  /**
   * Builds a request carrying the given headers.
   */
  private function request(array $headers): Request {
    $request = Request::create('/island-test');
    foreach ($headers as $name => $value) {
      $request->headers->set($name, $value);
    }
    return $request;
  }

  /**
   * Both headers together are the island signature, and they deny.
   */
  public function testBothHeadersDenyThePageCache(): void {
    $policy = new IslandPageCacheRequestPolicy();

    $this->assertSame(
      RequestPolicyInterface::DENY,
      $policy->check($this->request(['HX-Request' => 'true', 'HX-Target' => 'island-tasks-task_list'])),
    );
  }

  /**
   * Anything less than both headers is not this policy's business.
   *
   * NULL rather than ALLOW, deliberately. ALLOW is a vote FOR caching, and
   * this policy knows nothing about the ordinary requests it is handed; voting
   * on them would make an island concern override whatever else the site
   * decided. Abstaining leaves the chain exactly as it was.
   */
  public function testAnythingLessThanBothHeadersAbstains(): void {
    $policy = new IslandPageCacheRequestPolicy();

    $this->assertNull($policy->check($this->request([])));
    $this->assertNull($policy->check($this->request(['HX-Request' => 'true'])));
    $this->assertNull($policy->check($this->request(['HX-Target' => 'island-tasks-task_list'])));
    $this->assertNull($policy->check($this->request(['HX-Boosted' => 'true'])));
  }

  /**
   * HX-Boosted without HX-Request denies too: the subscriber answers it.
   *
   * The two halves of this guard must key on the same requests or the guard has
   * a hole exactly the width of their difference. IslandGetSubscriber fires on
   * `HX-Boosted` — core's isHtmxBoosted() reads that header and no other.
   * This policy used to require `HX-Request`. Real htmx sends both, and
   * an attacker is not obliged to: `HX-Boosted` plus `HX-Target` and no
   * `HX-Request` was answered with an island fragment AND left cacheable.
   * The fragment was stored under the page's own url and served to every
   * subsequent
   * anonymous visitor as the whole document.
   *
   * Closed on both sides — the subscriber now also requires `HX-Request` — and
   * this case stays because a guard that depends on the other half staying
   * narrow is not a guard.
   */
  public function testBoostedWithoutHxRequestDeniesToo(): void {
    $policy = new IslandPageCacheRequestPolicy();

    $this->assertSame(
      RequestPolicyInterface::DENY,
      $policy->check($this->request(['HX-Boosted' => 'true', 'HX-Target' => 'island-tasks-task_list'])),
    );
  }

  /**
   * The policy is actually in the chain the page-cache middleware consults.
   *
   * The class returning DENY in isolation proves nothing on its own: the
   * hazard is only closed if the service tag reaches that chain.
   *
   * The obvious assertion — hand the chain a boosted request and expect DENY —
   * is a FALSE GREEN here and was written before it was caught. Core's
   * CommandLineOrUnsafeMethod policy denies whenever PHP_SAPI is 'cli', which
   * a kernel test always is, so the chain answers DENY for every request with
   * or without this module and the assertion can never fail. Membership is
   * what is actually observable at this level; the real anonymous round trip
   * is the browser harness's job.
   */
  public function testThePolicyIsRegisteredInBothCacheChains(): void {
    foreach (['page_cache_request_policy', 'dynamic_page_cache_request_policy'] as $service) {
      $rules = (new \ReflectionProperty(ChainRequestPolicy::class, 'rules'))
        ->getValue($this->container->get($service));

      $this->assertContains(
        IslandPageCacheRequestPolicy::class,
        array_map(static fn(object $rule): string => $rule::class, $rules),
        sprintf('The island policy is missing from %s.', $service),
      );
    }
  }

}
