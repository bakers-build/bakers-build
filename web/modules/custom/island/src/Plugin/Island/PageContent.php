<?php

declare(strict_types=1);

namespace Drupal\island\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandBoost;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandProfileHost;
use Drupal\island\IslandRuntimeId;

/**
 * Renders the current route's controller result supplied by the app host.
 */
#[Island(
  id: 'page_content',
  label: new TranslatableMarkup('Page content'),
  description: new TranslatableMarkup('Renders the current page controller result.'),
  type: 'page_content',
)]
final class PageContent extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function boost(): IslandBoost {
    $boost = IslandBoost::to();
    $host = $this->configuration['contexts']['host'] ?? NULL;
    $also = $this->configuration['also_placements'] ?? [];
    if ($host instanceof IslandProfileHost && $also !== []) {
      $app = $host->getApp();
      $profile = $host->getProfile();
      foreach ($also as $placement_id) {
        $boost->also(IslandRuntimeId::forPlacement(
          (string) $app->id(),
          (string) $profile->id(),
          $host->getInstanceId(),
          (string) $placement_id,
        ));
      }
    }
    return $boost;
  }

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $content = $data['content'] ?? [];
    $prefix = [];
    foreach ($this->configuration['prefix_blocks'] ?? [] as $id => $configuration) {
      $block = $this->islandManager->createInstance('block', $configuration);
      assert($block instanceof IslandInterface);
      $prefix[$id] = $block->build($data, $options);
    }
    $content = is_array($content) ? $content : [];

    return $prefix === [] ? $content : $prefix + ['content' => $content];
  }

}
