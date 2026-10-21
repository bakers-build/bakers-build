<?php

declare(strict_types=1);

namespace Drupal\island\PageCache;

use Drupal\Core\PageCache\RequestPolicyInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Keeps boosted island requests out of the internal page cache.
 *
 * Page cache and dynamic page cache key on the url, not on htmx headers, so a
 * boosted GET would store a fragment as the page or be answered with the whole
 * page. Tagged for both caches.
 */
final class IslandPageCacheRequestPolicy implements RequestPolicyInterface {

  /**
   * {@inheritdoc}
   */
  public function check(Request $request): ?string {
    // Must deny whatever IslandGetSubscriber answers, which includes
    // HX-Boosted without HX-Request.
    $signalled = $request->headers->has('HX-Request') || $request->headers->has('HX-Boosted');
    if ($signalled && $request->headers->has('HX-Target')) {
      return static::DENY;
    }
    // Abstain rather than ALLOW: this policy has no say on ordinary requests.
    return NULL;
  }

}
