<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Plugin\Exception\PluginException;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Resolves a host id to its tagged context provider service.
 */
final class IslandHostResolver {

  /**
   * The collected host providers, keyed by host id.
   *
   * @var \Drupal\island\IslandContextProviderInterface[]
   */
  private array $providers = [];

  public function __construct(
    private readonly IslandPluginManagerInterface $islandManager,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AppProviderManager $appProviderManager,
    private readonly RequestStack $requestStack,
    private readonly IslandConditionEvaluator $evaluator,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function addProvider(IslandContextProviderInterface $provider): void {
    $this->providers[$provider->hostId()] = $provider;
  }

  /**
   * {@inheritdoc}
   */
  public function resolve(string $host_id): ?IslandContextProviderInterface {
    if (isset($this->providers[$host_id])) {
      return $this->providers[$host_id];
    }
    // Page controllers register their own hosts on GET. Only a mutation may
    // reconstruct a persisted host; a stale navigation target must not revive
    // the previous page's profile on a different route.
    if (!$this->requestStack->getCurrentRequest()?->isMethod('POST')) {
      return NULL;
    }
    return $this->resolveProfileHost($host_id);
  }

  /**
   * Reconstructs a persisted profile for a fresh action or form request.
   */
  private function resolveProfileHost(string $host_id): ?IslandProfileHost {
    $tuple = $this->decodeProfileHost($host_id);
    if ($tuple === NULL) {
      return NULL;
    }
    [$app_id, $profile_id, $instance_id] = $tuple;
    $app = $this->entityTypeManager->getStorage('island_app')->load($app_id);
    $profile = $this->entityTypeManager->getStorage('island_profile')->load($profile_id);
    if (!$app instanceof App || !$app->status() || !$profile instanceof IslandProfile || !$profile->status() || $profile->getAppId() !== $app_id) {
      return NULL;
    }
    $provider = $this->appProviderManager->get($app->getProviderId());
    if ($provider === NULL) {
      return NULL;
    }
    $host = new IslandProfileHost($app, $profile, $provider, $instance_id, $this->evaluator);
    $this->addProvider($host);
    return $host;
  }

  /**
   * Decodes only a bounded tuple of three nonempty string identifiers.
   *
   * @return array{string, string, string}|null
   *   App, profile and instance identifiers, or NULL for an invalid identity.
   */
  private function decodeProfileHost(string $host_id): ?array {
    if (!preg_match('/^profile_([a-f0-9]{2,2048})$/', $host_id, $matches) || strlen($matches[1]) % 2 !== 0) {
      return NULL;
    }
    $tuple = json_decode((string) hex2bin($matches[1]), TRUE);
    if (!is_array($tuple) || count($tuple) !== 3 || array_keys($tuple) !== [0, 1, 2]) {
      return NULL;
    }
    foreach ($tuple as $part) {
      if (!is_string($part) || $part === '') {
        return NULL;
      }
    }
    return [(string) $tuple[0], (string) $tuple[1], (string) $tuple[2]];
  }

  /**
   * Resolves a host placement id to its actual plugin id.
   */
  public function pluginId(string $island_id, IslandContextProviderInterface $host): string {
    if (method_exists($host, 'getIslandPluginId')) {
      return (string) $host->getIslandPluginId($island_id);
    }
    return $island_id;
  }

  /**
   * Resolves an island html id to what can render it.
   *
   * The id is parsed, never searched: machine names are `[a-z0-9_]` and
   * getHtmlId() keeps underscores, so `island-<host>-<plugin>` splits on its
   * first two hyphens. The island is then verified against its own html id,
   * so an overridden getHtmlId() is a miss rather than a wrong island.
   *
   * @param string $html_id
   *   An island container's html id, without the leading '#'.
   *
   * @return array{host: \Drupal\island\IslandContextProviderInterface, island_id: string, island: \Drupal\island\IslandInterface}|null
   *   The host, island id and the island INSTANCE, or NULL when the id names
   *   none. The instance rides along because the verification above had to
   *   build it: handing it back costs nothing and spares every caller a second
   *   instantiation of the same island.
   */
  public function resolveHtmlId(string $html_id): ?array {
    $parts = explode('-', $html_id, 3);
    if (count($parts) !== 3 || $parts[0] !== 'island' || $parts[1] === '' || $parts[2] === '') {
      return NULL;
    }
    [, $host_id, $plugin_id] = $parts;

    $host = $this->resolve($host_id);
    if ($host === NULL) {
      return NULL;
    }
    $island = $this->verifiedIsland($host, $plugin_id, $html_id);

    return $island === NULL ? NULL : ['host' => $host, 'island_id' => $plugin_id, 'island' => $island];
  }

  /**
   * The island this host claims under exactly this html id, if any.
   */
  private function verifiedIsland(IslandContextProviderInterface $host, string $plugin_id, string $html_id): ?IslandInterface {
    if (!in_array($plugin_id, $host->getIslandIds(), TRUE)) {
      return NULL;
    }
    $configuration = $host->getIslandConfiguration($plugin_id);
    $configuration['contexts']['host'] = $host;
    $configuration['contexts']['placement_id'] = $plugin_id;
    try {
      $island = $this->islandManager->createInstance($this->pluginId($plugin_id, $host), $configuration);
    }
    catch (PluginException) {
      // A host listing an island id with no plugin behind it is a broken host,
      // not a broken request. Everything else on this path answers an id it
      // cannot serve with a miss, and letting this one exception through would
      // make an ordinary boosted click a 500 while the same page loads fine
      // directly.
      return NULL;
    }
    if (!$island instanceof IslandInterface || $island->getHtmlId($host->hostId()) !== $html_id) {
      return NULL;
    }
    return $island;
  }

}
