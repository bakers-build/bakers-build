<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

/**
 * Fixture island that exposes IslandPluginBase::linkToRoute()'s output.
 *
 * `linkToRoute()` is protected, and rightly so: it is the base class's own
 * link builder, not an API. A fixture plugin is where a test's reach into it
 * belongs; a public accessor on the production base class would be a method
 * called only from tests.
 *
 * It is the only caller in the repository that lets the target DEFAULT — every
 * other one names its target explicitly — so it is what pins the module's whole
 * target rule: a component link addresses its own island unless it says
 * otherwise. The second link is the same builder with pushUrl off, whose
 * accepted consequence IslandPluginBase documents. IslandRouteLinkTest renders
 * both.
 *
 * It is deliberately absent from TestHostProvider::getIslandIds(), so it never
 * joins a host's island set and cannot change what an event dispatch
 * enumerates.
 */
#[Island(
  id: 'link_demo',
  label: new TranslatableMarkup('Link demo'),
  type: 'view',
)]
final class LinkIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return [
      // The labels differ so a test can tell the two anchors apart; the point
      // of the pair is the flag, and both otherwise take the same arguments.
      'pushing' => $this->linkToRoute('island_test.other', [], 'Pushing'),
      'not_pushing' => $this->linkToRoute('island_test.other', [], 'Not pushing', NULL, FALSE),
      '#cache' => ['max-age' => 0],
    ];
  }

}
