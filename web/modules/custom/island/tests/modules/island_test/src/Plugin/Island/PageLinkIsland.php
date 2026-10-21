<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

/**
 * Fixture island exposing IslandPluginBase::linkToPage()'s output.
 *
 * Deliberately absent from TestHostProvider::getIslandIds(), so it never joins
 * a host's island set and cannot change what an event dispatch enumerates.
 */
#[Island(
  id: 'page_link_demo',
  label: new TranslatableMarkup('Page link demo'),
  type: 'view',
)]
final class PageLinkIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return [
      'plain' => $this->linkToPage('island_test.other', [], 'Other', '#page-content'),
      'with_query' => $this->linkToPage(
        'island_test.other',
        [],
        'Other page 2',
        '#page-content',
        TRUE,
        ['query' => ['page' => '2']],
      ),
      '#cache' => ['max-age' => 0],
    ];
  }

}
