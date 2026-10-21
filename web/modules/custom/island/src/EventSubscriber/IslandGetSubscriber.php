<?php

declare(strict_types=1);

namespace Drupal\island\EventSubscriber;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Cache\CacheableResponse;
use Drupal\Core\Htmx\HtmxRequestInfoTrait;
use Drupal\island\IslandBoost;
use Drupal\island\IslandFragmentResolver;
use Drupal\island\IslandResponder;
use Psr\Log\LoggerInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpKernel\Event\ViewEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Answers a boosted navigation with exactly the islands the client named.
 *
 * The server decides nothing. It reads `HX-Target` — which htmx sends on every
 * request, carrying the id of the element it resolved — and `X-Island-Also`,
 * which IslandBoost put on the container. Both are lookups. There is no route
 * table, no comparison against the previous page and no client state.
 *
 * Runs at `kernel.view`, not `kernel.request`, so a controller's own 404
 * still 404s on a boosted click; the page build array is discarded unrendered.
 *
 * Priority 200 puts it above core's HtmxContentViewSubscriber (100), which is
 * above MainContentViewSubscriber (0).
 */
final class IslandGetSubscriber implements EventSubscriberInterface {

  use HtmxRequestInfoTrait;

  public function __construct(
    private readonly RequestStack $requestStack,
    private readonly IslandFragmentResolver $fragmentResolver,
    private readonly IslandResponder $responder,
    private readonly LoggerInterface $logger,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::VIEW => [['onView', 200]]];
  }

  /**
   * {@inheritdoc}
   */
  protected function getRequest(): Request {
    $request = $this->requestStack->getCurrentRequest();
    if ($request === NULL) {
      throw new \LogicException('IslandGetSubscriber ran outside a request.');
    }
    return $request;
  }

  /**
   * Replaces a page result with the declared island fragments.
   */
  public function onView(ViewEvent $event): void {
    // Navigation only (GET/HEAD); mutations go through the route's own form.
    // Main request only: a 404 sub-request inherits the island headers.
    if (!$event->isMainRequest()) {
      return;
    }
    // Boosted only: linkToRoute() links are htmx GETs targeting an island
    // too, and answering them here would strip core's <title>. HX-Request is
    // also required so this matches IslandPageCacheRequestPolicy exactly.
    if (!$this->getRequest()->isMethodCacheable() || !$this->isHtmxRequest() || !$this->isHtmxBoosted()) {
      return;
    }
    $target = $this->getHtmxTarget();
    // No HX-Target means the element had no id, so it is no island.
    if ($target === '' || !is_array($event->getControllerResult())) {
      return;
    }
    // The access decisions this answer rests on, collected as it is built. A
    // fragment rendered under a permission check must not be served from a
    // cache to somebody without it, so the decisions' own contexts and tags go
    // onto the response.
    $access = new CacheableMetadata();
    $fragments = $this->fragments($target, $access, $event->getControllerResult());
    if ($fragments === []) {
      if (str_starts_with($target, 'island-profile_')) {
        // The destination selected another profile (or none). Its response
        // cannot replace the previous profile's placement: render a normal
        // document at the destination instead of emptying the old target.
        $query = $this->getRequest()->query->all();
        unset($query['ajax_page_state'], $query['_wrapper_format']);
        $destination = $this->getRequest()->getBaseUrl() . $this->getRequest()->getPathInfo();
        if ($query !== []) {
          $destination .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        }
        $response = new CacheableResponse('', 200, ['HX-Redirect' => $destination]);
        $response->getCacheableMetadata()->setCacheMaxAge(0);
        $event->setResponse($response);
      }
      return;
    }

    $response = $this->responder->toFragmentResponse($fragments);
    $response->addCacheableDependency($access);
    // The answer varies on the declaration, and on nothing else.
    $response->getCacheableMetadata()->addCacheContexts([
      'headers:HX-Target',
      'headers:' . IslandBoost::ALSO_HEADER,
    ]);
    $event->setResponse($response);
  }

  /**
   * The fragment descriptors for one declaration, main fragment first.
   *
   * @param string $target
   *   The requested main island html id.
   * @param \Drupal\Core\Cache\CacheableMetadata $access
   *   Cacheability collected from fragment access decisions.
   * @param array<string, mixed> $controller_result
   *   The ordinary controller result, used by the page-content placement.
   *
   * @return array<string, array{id: string, content: array, oob: bool, boost: \Drupal\island\IslandBoost|null, events: array<string>}>
   *   Empty when the target names no island, which is how a boosted request
   *   that has nothing to do with islands falls through to the normal page.
   */
  private function fragments(string $target, CacheableMetadata $access, array $controller_result): array {
    $main = $this->fragmentResolver->fragment($target, FALSE, $access, $controller_result);
    if ($main === NULL) {
      return [];
    }
    $fragments = ['main' => $main];
    foreach ($this->alsoIds($target) as $html_id) {
      $peer = $this->fragmentResolver->fragment($html_id, TRUE, $access, $controller_result);
      // An id that resolves to nothing is skipped rather than fatal: htmx
      // already treats a missing hx-select-oob selector as optional, and the
      // server refusing the whole response over one stale id would be stricter
      // than the client that asked for it. A fragment the visitor may not see
      // takes the same exit, which is what keeps the extra header from
      // answering "does this exist" differently from "may I have it".
      if ($peer !== NULL) {
        $fragments['oob_' . $html_id] = $peer;
      }
    }
    return $fragments;
  }

  /**
   * The most extra islands one request may ask for.
   *
   * The header is client-supplied and every entry costs a resolve, an access
   * check and a render, while the page-cache policy denies the request so none
   * of it is served from a cache — a header naming several hundred resolvable
   * ids would be cheap to send and expensive to answer. No real declaration
   * comes close: IslandBoost derives the list from the container's own id plus
   * whatever also() names, and the design's own motivating case is one entry.
   * The excess is DROPPED rather than refused, which is the same answer every
   * other unusable id in this header gets.
   */
  private const int MAX_ALSO = 16;

  /**
   * The extra island ids the client declared, without the target itself.
   *
   * @return string[]
   *   Html ids, de-duplicated, in declaration order, capped at MAX_ALSO.
   */
  private function alsoIds(string $target): array {
    $raw = $this->getRequest()->headers->get(IslandBoost::ALSO_HEADER, '');
    $ids = array_filter(array_map('trim', explode(',', (string) $raw)));
    $ids = array_values(array_unique(array_diff($ids, [$target])));
    if (count($ids) > self::MAX_ALSO) {
      // Not silently. A truncated tail is an island that stops updating with no
      // error, which is the exact failure mode the nesting guard exists to
      // surface — so the one place the server drops part of a declaration says
      // so.
      //
      // An attacker's oversized header logs too, and the honest bound is ONE
      // row per request, not none: this line is reached only after the main
      // target resolved AND was allowed. That is the same exposure core accepts
      // for its own "page not found" and "access denied" rows, and the same
      // consequence — on dblog, `row_limit` rotation, which makes it an
      // evidence-destruction primitive rather than a disk one. (An earlier
      // version of this comment argued the page-cache denial bounded it. It
      // does not: denying the cache makes the request more expensive to serve
      // and places no bound at all on how many rows are written.)
      $this->logger->warning(sprintf(
        'A boosted request declared %d extra islands; only the first %d were rendered.',
        count($ids),
        self::MAX_ALSO,
      ));
    }
    return array_slice($ids, 0, self::MAX_ALSO);
  }

}
