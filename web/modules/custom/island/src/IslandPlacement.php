<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * Turns a (host id, island id) pair into an island instance, or into markup.
 *
 * The only correct way to get an island from outside this module: it needs
 * its host's configuration and context, and an html id
 * `island-<host>-<plugin>` that `IslandHostResolver` can parse back.
 *
 * `::place()` serves a page and yields an empty render array for an absent
 * host or island; `::createIsland()` serves a fragment and throws, so a bad
 * request never becomes a silent empty swap. Both share instantiation, so a
 * page face and its rebuilt fragment stay the same shape.
 */
final class IslandPlacement {

  public function __construct(
    private readonly IslandHostResolver $hostResolver,
    private readonly IslandPluginManagerInterface $islandManager,
  ) {}

  /**
   * Builds one island of one host, wrapped in its own addressable container.
   *
   * @param string $host_id
   *   The host's stable id.
   * @param string $island_id
   *   The island plugin id the host declares.
   *
   * @return array<string, mixed>
   *   The wrapped island render array, or an empty array when the host or the
   *   island is absent.
   */
  public function place(string $host_id, string $island_id): array {
    $host = $this->hostResolver->resolve($host_id);
    if ($host === NULL || !in_array($island_id, $host->getIslandIds(), TRUE)) {
      return [];
    }
    try {
      $island = $this->createIsland($island_id, $host);
    }
    catch (\LogicException) {
      return [];
    }
    return IslandWrapper::wrap(
      $island->getHtmlId($host_id),
      $island->build($host->getIslandData($island_id)),
      FALSE,
      $island->boost(),
      array_keys($island->getSubscribedEvents()),
    );
  }

  /**
   * Creates an island instance wired to its host context.
   *
   * @param string $island_id
   *   The island plugin id.
   * @param \Drupal\island\IslandContextProviderInterface $host
   *   The host whose configuration and context the island is given.
   *
   * @return \Drupal\island\IslandInterface
   *   The instantiated island.
   *
   * @throws \LogicException
   *   When the plugin does not implement IslandInterface.
   */
  public function createIsland(string $island_id, IslandContextProviderInterface $host): IslandInterface {
    if (!in_array($island_id, $host->getIslandIds(), TRUE)) {
      throw new \LogicException(sprintf('Island placement "%s" is not enabled in this host.', $island_id));
    }
    $config = $host->getIslandConfiguration($island_id);
    $config['contexts']['host'] = $host;
    $plugin_id = $this->hostResolver->pluginId($island_id, $host);
    $config['contexts']['placement_id'] = $island_id;
    $island = $this->islandManager->createInstance($plugin_id, $config);
    if (!$island instanceof IslandInterface) {
      throw new \LogicException(sprintf('Island plugin "%s" does not implement IslandInterface.', $island_id));
    }
    return $island;
  }

}
