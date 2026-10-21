<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Controller\TitleResolverInterface;
use Drupal\Core\Session\AccountInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Routing\Route;

/**
 * Turns one client-supplied html id into an access-checked fragment.
 *
 * The boosted GET and the mutating POST path both render an island named by
 * an untrusted client string. This is the single place that string is
 * resolved and access-checked, so the paths cannot drift.
 */
final class IslandFragmentResolver {

  public function __construct(
    private readonly IslandHostResolver $hostResolver,
    private readonly AccountInterface $currentUser,
    private readonly LoggerInterface $logger,
    private readonly TitleResolverInterface $titleResolver,
    private readonly RequestStack $requestStack,
  ) {}

  /**
   * Hosts already reported as declaring no view access, keyed by host id.
   *
   * One row per host rather than one per resolved id: the extra header admits
   * sixteen ids and each is resolved on its own, so without this a single
   * request could write seventeen identical lines.
   *
   * @var array<string, true>
   */
  private array $reportedSilentHosts = [];

  /**
   * One island html id turned into a fragment descriptor.
   *
   * This ASKS for the declaration rather than composing one — the island is its
   * author — which is what makes a fragment response and the page build carry
   * the same attributes by construction instead of by two call sites agreeing.
   *
   * @param string $html_id
   *   The island container's html id, as the client named it.
   * @param bool $oob
   *   TRUE to mark the fragment for an out-of-band swap.
   * @param \Drupal\Core\Cache\CacheableMetadata $access
   *   Collects the cacheability of every access decision this makes, so the
   *   caller can put it on the response: a fragment rendered under a
   *   permission check must not be served from a cache to somebody without it.
   * @param array<string, mixed>|null $controller_result
   *   Current controller content for page-content navigation, when available.
   *
   * @return array{id: string, content: array, oob: bool, boost: \Drupal\island\IslandBoost|null, events: string[]}|null
   *   NULL when the id resolves to no island, or to one this visitor may not
   *   see. The two are deliberately the same answer.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function fragment(string $html_id, bool $oob, CacheableMetadata $access, ?array $controller_result = NULL): ?array {
    $resolved = $this->hostResolver->resolveHtmlId($html_id);
    if ($resolved === NULL) {
      return NULL;
    }
    // Every id in the request is attacker-controlled — the target and each
    // entry of the extra header alike — so the check runs per fragment rather
    // than once on the main one.
    $decision = $this->mayView($resolved);
    $access->addCacheableDependency($decision);
    if (!$decision->isAllowed()) {
      return NULL;
    }
    $data = $resolved['host']->getIslandData($resolved['island_id']);
    // Boosted navigation runs before the page variant can inject the current
    // controller result. Other callers retain their host-provided data.
    if ($controller_result !== NULL && $resolved['island']->getPluginId() === 'page_content') {
      $data['content'] = $controller_result;
      $request = $this->requestStack->getCurrentRequest();
      $route = $request?->attributes->get('_route_object');
      if ($request !== NULL && $route instanceof Route) {
        $data['title'] = $controller_result['#title'] ?? $this->titleResolver->getTitle($request, $route);
      }
    }
    return [
      'id' => $html_id,
      'content' => $resolved['island']->build($data),
      'oob' => $oob,
      'boost' => $resolved['island']->boost(),
      'events' => array_keys($resolved['island']->getSubscribedEvents()),
    ];
  }

  /**
   * Whether this visitor may see the resolved island on its own.
   *
   * A lookup: the host answers for its islands; nothing consults the route
   * or the referrer.
   *
   * A client-named fragment is a SECOND render entry point, which is why the
   * check runs here rather than being left to whatever put the island on the
   * page: nothing about a boosted request repeats the page build's own gate.
   *
   * @param array{host?: \Drupal\island\IslandContextProviderInterface, island_id?: string, island?: \Drupal\island\IslandInterface} $resolved
   *   What IslandHostResolver::resolveHtmlId() answered.
   */
  private function mayView(array $resolved): AccessResultInterface {
    $host = $resolved['host'] ?? NULL;
    // Forbidden by omission rather than open by omission. A host that never
    // declared an answer cannot have one guessed for it: the guess would be
    // wrong for exactly the host whose islands are worth protecting.
    if (!$host instanceof IslandViewAccessInterface) {
      // Debug, once per host per request: omitting the interface is a
      // supported state, and X-Island-Also admits sixteen ids per request.
      // A log rather than an assert(): the refusal is safe, the link still
      // works as an ordinary link.
      $host_id = $host?->hostId() ?? '(unresolved host)';
      if (!isset($this->reportedSilentHosts[$host_id])) {
        $this->reportedSilentHosts[$host_id] = TRUE;
        $this->logger->debug(
          'Island host "@host" does not implement IslandViewAccessInterface, so its islands do not answer boosted requests. Implement accessIsland() to declare who may see them.',
          ['@host' => $host_id],
        );
      }
      return AccessResult::forbidden('The island host declares no view access.');
    }
    return $host->accessIsland((string) ($resolved['island_id'] ?? ''), $this->currentUser);
  }

}
