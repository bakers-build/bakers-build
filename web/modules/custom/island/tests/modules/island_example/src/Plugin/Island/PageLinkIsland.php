<?php

declare(strict_types=1);

namespace Drupal\island_example\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

/**
 * Demo island whose link replaces the contents of the page's container.
 *
 * The component decides that its link is an htmx link, and it decides which
 * builder: `#page-content` is written by the theme's page template, so it is in
 * the document and never in the response fragment — which is exactly the case
 * linkToPage() exists for (spec D3). A linkToRoute() link here would select on
 * an id the fragment does not contain and swap nothing.
 *
 * Deliberately absent from TaskHostProvider::getIslandIds(), so it never joins
 * the host's island set and cannot change what an event dispatch enumerates.
 */
#[Island(
  id: 'page_link',
  label: new TranslatableMarkup('Page link demo'),
  type: 'view',
)]
final class PageLinkIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $link = $this->linkToPage(
      'island_example.page_link_target',
      [],
      'Go to the target page',
      '#page-content',
    );
    // Assigned rather than merged: the builder writes its own `#attributes`.
    $link['#attributes']['data-testid'] = 'page-link';
    return [
      '#cache' => ['max-age' => 0],
      'link' => $link,
    ];
  }

}
