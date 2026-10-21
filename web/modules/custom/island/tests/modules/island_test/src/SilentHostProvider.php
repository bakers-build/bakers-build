<?php

declare(strict_types=1);

namespace Drupal\island_test;

use Drupal\island\IslandContextProviderInterface;

/**
 * A host that says nothing about who may view its islands.
 *
 * It implements the host seam and NOT IslandViewAccessInterface, which is the
 * whole point of it: the boosted GET path must refuse a host that never
 * declared an answer, rather than assume one. Without this fixture the
 * secure-by-omission rule would be an untested sentence in a docblock.
 */
final class SilentHostProvider implements IslandContextProviderInterface {

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'silent';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return ['quiet'];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(string $island_id): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    return [];
  }

}
