<?php

declare(strict_types=1);

namespace Drupal\island_example\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandBoost;
use Drupal\island\IslandPluginBase;

/**
 * A permanently cacheable island, for the page-cache hazard (BB-408 R1).
 *
 * Every other demo route is marked `no_cache` because its pages embed
 * session-bound CSRF tokens, and a page the internal page cache never stores
 * cannot demonstrate the one hazard this design creates. This island renders a
 * constant and holds no token, so the route that hosts it is genuinely
 * cacheable for an anonymous visitor — which is the only condition under which
 * the poisoning is observable at all.
 */
#[Island(
  id: 'cacheable',
  label: new TranslatableMarkup('Cacheable island'),
  type: 'view',
)]
final class CacheableIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return [
      '#type' => 'html_tag',
      '#tag' => 'span',
      '#attributes' => ['data-testid' => 'cacheable-island'],
      '#value' => 'island only',
    ];
  }

  /**
   * {@inheritdoc}
   *
   * It declares one so that the page-cache hazard is measured against a
   * container that is genuinely boosted, rather than against one the harness
   * only sends handmade headers at.
   */
  public function boost(): IslandBoost {
    return IslandBoost::to();
  }

}
