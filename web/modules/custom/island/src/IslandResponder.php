<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Cache\CacheableResponse;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\Session\AccountInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Turns an IslandResponse into a CacheableResponse of HTML fragments.
 *
 * All fragments are computed in the same request: the triggering island as
 * the main fragment, explicit peers and event subscribers as out-of-band
 * fragments.
 */
final class IslandResponder {

  public function __construct(
    protected RendererInterface $renderer,
    protected IslandPluginManagerInterface $islandManager,
    protected IslandPlacement $placement,
    protected AccountInterface $currentUser,
  ) {}

  /**
   * Builds the fragment response for a mutation result.
   *
   * A routed dialog may dispatch events without being a placed island.
   */
  public function toResponse(IslandResponse $response, ?IslandInterface $triggering, IslandContextProviderInterface $host): CacheableResponse {
    $fragments = [];
    $access = new CacheableMetadata();
    $eligible = $this->eligiblePlacements($host, $access);
    $triggering_id = $triggering === NULL ? '' : $this->runtimeIslandId($triggering);

    if ($triggering !== NULL && $response->shouldRebuildSelf() && in_array($triggering_id, $eligible, TRUE)) {
      $fragments[$triggering_id] = $this->fragment(
        $triggering,
        $host,
        $triggering->build($host->getIslandData($triggering_id)),
        FALSE,
      );
    }

    foreach ($response->getRebuilds() as $island_id) {
      if ($island_id === $triggering_id || !in_array($island_id, $eligible, TRUE)) {
        continue;
      }
      $fragments[$island_id] = $this->buildRebuildFragment($island_id, $host);
    }

    foreach ($response->getEvents() as $event_name => $payload) {
      $fragments += $this->buildEventFragments($event_name, $payload, $triggering_id, $host, $eligible);
    }

    $http = $this->toFragmentResponse($fragments);
    $http->addCacheableDependency($access);
    $this->applyHtmxHeaders($response, $http);

    return $http;
  }

  /**
   * Dispatches a completed dialog's events and closes its hull after OOB swaps.
   */
  public function toDialogResponse(IslandResponse $response, Request $request): CacheableResponse {
    $host = $request->attributes->get('_island_profile_host');
    if (!$host instanceof IslandProfileHost) {
      throw new \LogicException('A dialog event response requires an active page profile.');
    }
    // Embedded forms must not consume the completed submission again.
    $request->request->replace([]);
    $http = $this->toResponse($response, NULL, $host);
    $http->headers->set('HX-Retarget', 'closest [data-dialog]');
    $http->headers->set('HX-Reswap', 'delete');
    return $http;
  }

  /**
   * Renders island fragments into one cacheable response.
   *
   * The single renderer for the mutation and boosted GET paths. Always a root
   * render: only the root pass replaces lazy-builder placeholders such as a
   * form's CSRF token and action; without it a submit silently fails once.
   *
   * @param array<string, array{id: string, content: array, oob: bool, boost?: \Drupal\island\IslandBoost|null, events?: string[]}> $fragments
   *   Island fragments, keyed for render-array stability. Each carries the
   *   island's html id, its content, whether it is out of band, and what its
   *   owner declares about the links inside it. The FIRST fragment is
   *   conventionally the main one; out-of-band is per fragment and never
   *   inferred from position.
   */
  public function toFragmentResponse(array $fragments): CacheableResponse {
    $build = [];
    foreach ($fragments as $key => $fragment) {
      $build[$key] = IslandWrapper::wrap(
        $fragment['id'],
        $fragment['content'],
        $fragment['oob'],
        $fragment['boost'] ?? NULL,
        $fragment['events'] ?? [],
      );
    }

    // renderInIsolation() takes its build BY REFERENCE and writes the bubbled
    // #cache back into it, which is what createFromRenderArray() below reads a
    // line later. It pops its own render context internally, so nothing here
    // has to open one.
    $html = (string) $this->renderer->renderInIsolation($build);
    $http = new CacheableResponse($html);
    $http->addCacheableDependency(CacheableMetadata::createFromRenderArray($build));

    return $http;
  }

  /**
   * Applies the HX-Trigger and HX-Location headers of the island response.
   */
  private function applyHtmxHeaders(IslandResponse $response, CacheableResponse $http): void {
    $htmx = new Htmx();
    $client_events = $response->getClientEvents();
    if ($client_events !== []) {
      $htmx->triggerHeader($client_events);
    }
    $location = $response->getLocation();
    if ($location !== NULL) {
      $htmx->locationHeader($location);
    }
    foreach ($htmx->getHeaders()->all() as $name => $values) {
      foreach ((array) $values as $value) {
        $http->headers->set($name, $value);
      }
    }
  }

  /**
   * One island plus its rendered content, as a fragment descriptor.
   *
   * Every descriptor this class produces goes through here, so every island a
   * mutation answers with carries the same declaration its page build did.
   * That matters even though a mutation response is not itself navigated
   * from: a rebuilt island replaces the one in the document, and an island
   * that came back bare would have stopped boosting from then on.
   *
   * @return array{id: string, content: array, oob: bool, boost: \Drupal\island\IslandBoost|null, events: string[]}
   *   The fragment descriptor toFragmentResponse() consumes.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function fragment(IslandInterface $island, IslandContextProviderInterface $host, array $content, bool $oob): array {
    return [
      'id' => $island->getHtmlId($host->hostId()),
      'content' => $content,
      'oob' => $oob,
      'boost' => $island->boost(),
      'events' => array_keys($island->getSubscribedEvents()),
    ];
  }

  /**
   * Resolves currently accessible members before constructing response plugins.
   *
   * @return string[]
   *   Placement IDs eligible for this response.
   */
  private function eligiblePlacements(IslandContextProviderInterface $host, CacheableMetadata $cache): array {
    $eligible = [];
    foreach ($host->getIslandIds() as $placement_id) {
      if ($host instanceof IslandViewAccessInterface) {
        $access = $host->accessIsland($placement_id, $this->currentUser);
        $cache->addCacheableDependency($access);
        if (!$access->isAllowed()) {
          continue;
        }
      }
      $eligible[] = $placement_id;
    }
    return $eligible;
  }

  /**
   * Gets the stable placement id when a plugin supports profile instances.
   */
  private function runtimeIslandId(IslandInterface $island): string {
    return method_exists($island, 'getRuntimeIslandId')
      ? $island->getRuntimeIslandId()
      : $island->getPluginId();
  }

  /**
   * Builds one peer island's out-of-band fragment.
   *
   * @return array{id: string, content: array, oob: bool, boost: \Drupal\island\IslandBoost|null, events: string[]}
   *   The fragment descriptor toFragmentResponse() consumes.
   */
  private function buildRebuildFragment(string $island_id, IslandContextProviderInterface $host): array {
    $island = $this->placement->createIsland($island_id, $host);
    return $this->fragment($island, $host, $island->build($host->getIslandData($island_id)), TRUE);
  }

  /**
   * Builds the out-of-band fragments of one event's subscribed peers.
   *
   * @return array<string, array{id: string, content: array, oob: bool, boost: \Drupal\island\IslandBoost|null, events: string[]}>
   *   Fragment descriptors, keyed by event and island.
   */
  private function buildEventFragments(string $event_name, array $payload, string $triggering_id, IslandContextProviderInterface $host, array $eligible): array {
    $fragments = [];
    foreach ($eligible as $island_id) {
      if ($island_id === $triggering_id) {
        continue;
      }
      if (method_exists($host, 'getPlacementEvents')) {
        $events = $host->getPlacementEvents($island_id);
        if ($events !== [] && !in_array($event_name, $events, TRUE)) {
          continue;
        }
      }
      $island = $this->placement->createIsland($island_id, $host);
      $subscribed = $island->getSubscribedEvents();
      if (!isset($subscribed[$event_name])) {
        continue;
      }
      $event = new IslandEvent($event_name, $payload, $triggering_id, $host->hostId());
      $fragment = $island->{$subscribed[$event_name]}($event);
      // NULL leaves the island untouched and never emits markup.
      if (!is_array($fragment)) {
        continue;
      }
      $fragments[$island_id] = $this->fragment($island, $host, $fragment, TRUE);
    }
    return $fragments;
  }

}
