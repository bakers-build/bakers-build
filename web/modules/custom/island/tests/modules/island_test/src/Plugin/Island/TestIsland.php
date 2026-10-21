<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

/**
   * Minimal island fixture for discovery and contract tests.
 */
#[Island(
  id: 'test_island',
  label: new TranslatableMarkup('Test island'),
  description: new TranslatableMarkup('Kernel test fixture.'),
  type: 'widget',
  icon: 'test',
  default_region: 'content',
  enabled_by_default: TRUE,
)]
final class TestIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return ['#markup' => 'test-island:' . ($data['marker'] ?? 'none')];
  }

}
