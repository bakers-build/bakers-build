<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandBoost;
use Drupal\island\IslandPluginBase;

/**
 * An island that declares its own client-side update contract.
 *
 * It is the rail case: its links replace a DIFFERENT island, so it names
 * itself as the fragment that rides along out of band. That makes it the one
 * fixture that can show the declaration on all three renders of one island —
 * a page build, a main GET fragment, and an out-of-band peer.
 */
#[Island(
  id: 'rail',
  label: new TranslatableMarkup('Rail'),
  type: 'view',
)]
final class RailIsland extends IslandPluginBase {

  /**
   * The island this rail's links replace.
   */
  private const CONTENT_TARGET = '#island-tasks-task_list';

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return ['#markup' => 'rail:' . $data['count']];
  }

  /**
   * {@inheritdoc}
   */
  public function boost(): IslandBoost {
    return IslandBoost::to(self::CONTENT_TARGET);
  }

}
