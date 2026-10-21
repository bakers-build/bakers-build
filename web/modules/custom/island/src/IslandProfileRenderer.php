<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Plugin\Exception\PluginException;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Renders a persisted Island Profile through its selected SDC.
 */
final class IslandProfileRenderer {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly IslandPluginManagerInterface $islandManager,
    private readonly AppProviderManager $providerManager,
    private readonly IslandHostResolver $hostResolver,
    private readonly IslandConditionEvaluator $evaluator,
  ) {
  }

  /**
   * Builds one scoped runtime instance of a profile.
   *
   * @SuppressWarnings("PHPMD.CyclomaticComplexity")
   * @SuppressWarnings("PHPMD.NPathComplexity")
   *
   * @return array<string, mixed>
   *   A Drupal render array for the profile SDC.
   */
  public function render(IslandProfile $profile, string $instance_id = 'default', array $page_context = []): array {
    $host = $this->registerHost($profile, $instance_id);
    if ($host === NULL) {
      return [];
    }
    $app = $host->getApp();
    $provider = $this->providerManager->get($app->getProviderId());
    if ($provider === NULL) {
      return [];
    }
    $cache = (new CacheableMetadata())->addCacheableDependency($app)->addCacheableDependency($profile);
    $slots = [];
    foreach ($profile->getPlacementsBySlot() as $slot_id => $placements) {
      foreach ($placements as $placement_id => $placement) {
        if (!$placement['enabled']) {
          continue;
        }
        // Visibility is decided before the source is built or its data read; a
        // hidden placement leaves only its cacheability behind.
        $visible = $host->placementVisibility($placement_id);
        $cache->addCacheableDependency($visible);
        if (!$visible->isAllowed()) {
          continue;
        }
        $access = $provider->accessIsland($app, $profile, $placement_id, $instance_id);
        $cache->addCacheableDependency($access);
        if (!$access->isAllowed()) {
          continue;
        }
        $plugin_id = (string) ($placement['plugin_id'] ?? '');
        if ($plugin_id === '') {
          continue;
        }
        $configuration = $provider->getIslandConfiguration($app, $profile, $placement_id);
        $configuration['contexts']['host'] = $host;
        $configuration['contexts']['placement_id'] = $placement_id;
        try {
          $island = $this->islandManager->createInstance($plugin_id, $configuration);
        }
        catch (PluginException) {
          // Configuration can outlive an optional plugin module. Keep the
          // profile and its other placements renderable until an administrator
          // repairs the unavailable placement.
          continue;
        }
        if (!$island instanceof IslandInterface) {
          continue;
        }
        $data = $provider->getIslandData($app, $profile, $placement_id, $instance_id);
        if ($plugin_id === 'page_content' && isset($page_context['content'])) {
          $data['content'] = $page_context['content'];
          if (isset($page_context['title'])) {
            $data['title'] = $page_context['title'];
          }
        }
        $html_id = IslandRuntimeId::forPlacement((string) $app->id(), (string) $profile->id(), $instance_id, $placement_id);
        $slots[$slot_id][$placement_id] = IslandWrapper::wrap(
          $html_id,
          $island->build($data),
          FALSE,
          $island->boost(),
          array_keys($island->getSubscribedEvents()),
        );
      }
    }

    $build = [
      '#type' => 'component',
      '#component' => $profile->getLayoutId(),
      '#props' => $profile->getLayoutSettings(),
      '#slots' => $slots,
    ];
    $cache->applyTo($build);
    return $build;
  }

  /**
   * Registers a profile host before a page is rendered.
   *
   * Boosted requests are intercepted at kernel.view, before a display
   * variant's render array is rendered. Registering here gives the HTMX
   * subscriber the same profile-scoped host that the eventual page render
   * uses, so it can resolve the target and produce the requested fragment.
   *
   * @return \Drupal\island\IslandProfileHost|null
   *   The registered host, or NULL when the profile's app/provider is not
   *   available.
   */
  public function registerHost(IslandProfile $profile, string $instance_id = 'default'): ?IslandProfileHost {
    $app = $this->entityTypeManager->getStorage('island_app')->load($profile->getAppId());
    if (!$app instanceof App || !$app->status()) {
      return NULL;
    }
    $provider = $this->providerManager->get($app->getProviderId());
    if ($provider === NULL) {
      return NULL;
    }

    $host = new IslandProfileHost($app, $profile, $provider, $instance_id, $this->evaluator);
    $this->hostResolver->addProvider($host);
    return $host;
  }

}
