<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

/**
 * An island whose html id is NOT island-<host>-<plugin>.
 *
 * The id parse (BB-408 D4) is the reason this exists. Parsing is what lets
 * the resolver answer without walking every registered provider, and its one
 * assumption is that a plugin has not overridden getHtmlId(). This fixture
 * overrides it, so the resolver's verification step has something to catch:
 * `island-tasks-renamed` must come back as a MISS rather than as this island.
 * The alternative — trusting the parse — would hand a caller the wrong island
 * under a name that island does not answer to.
 */
#[Island(
  id: 'renamed',
  label: new TranslatableMarkup('Renamed island'),
  type: 'view',
)]
final class RenamedIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return ['#markup' => 'renamed'];
  }

  /**
   * {@inheritdoc}
   */
  public function getHtmlId(string $host_id): string {
    return 'island-' . $host_id . '-somewhere_else';
  }

}
