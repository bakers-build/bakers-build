<?php

declare(strict_types=1);

namespace Drupal\island_example\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandBoost;
use Drupal\island\IslandPluginBase;

/**
 * Demo chrome: a two-entry rail whose links the island itself authors.
 *
 * The rail links are authored by the island that renders them, through
 * IslandPluginBase::linkToRoute(). That is the claim the harness proves: the
 * component decides that its own links are htmx links, and nothing global
 * decides it for the product. title.spec.ts clicks one of them.
 *
 * linkToRoute() rather than linkToPage(), on the spec's own rule (D3): the
 * thing being replaced is `#island-tasks-content`, which the demo controller
 * renders INSIDE its result and which therefore appears in the response
 * fragment. A target that lives in the fragment is selected out of it and
 * replaced whole; only a container the page owns — one the fragment cannot
 * contain — is swapped by its contents.
 *
 * The links target the demo's inner content region rather than anything
 * wrapping the rail. A real shell rail behaves the same way for the same
 * reason: the rail is not part of what a rail link replaces, so a rail link
 * leaves the rail standing and swaps only the region below it.
 */
#[Island(
  id: 'chrome',
  label: new TranslatableMarkup('Demo chrome'),
  type: 'view',
)]
final class ChromeIsland extends IslandPluginBase {

  /**
   * The demo's swappable content region — see the class docblock.
   */
  private const CONTENT_REGION = '#island-tasks-content';

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $build = [
      '#type' => 'container',
      '#attributes' => ['data-testid' => 'demo-rail'],
      '#cache' => ['max-age' => 0],
      'active' => [
        '#type' => 'html_tag',
        '#tag' => 'span',
        '#attributes' => ['data-testid' => 'demo-rail-active'],
        '#value' => (string) ($data['active'] ?? ''),
      ],
    ];
    foreach (['island_example.tasks' => 'Tasks', 'island_example.notes' => 'Notes'] as $route => $label) {
      $build[$route] = $this->linkToRoute($route, [], $label, self::CONTENT_REGION);
      $build[$route]['#attributes']['data-testid'] = 'rail-' . $label;
    }
    // A PLAIN rail entry beside the two the island authors, and the whole
    // point is what it does NOT have: no hx-get, no hx-target, no attribute of
    // any kind. TasksController boosts the rail container, so this link
    // navigates by swapping the content region and bringing the rail — this
    // element included, with its active entry recomputed — along in the same
    // request. Two islands, one request, and nothing written on the anchor.
    $build['boost_notes'] = [
      '#type' => 'link',
      '#title' => 'Notes (boosted)',
      '#url' => Url::fromRoute('island_example.notes'),
      '#attributes' => ['data-testid' => 'rail-boost-Notes'],
    ];
    return $build;
  }

  /**
   * {@inheritdoc}
   *
   * The rail's links replace the content region, so the rail is not the
   * fragment being targeted and has to name itself to be re-rendered. The
   * SAME constant feeds this and linkToRoute() above, which is the point: one
   * value, one target, nothing to keep in step.
   */
  public function boost(): IslandBoost {
    return IslandBoost::to(self::CONTENT_REGION);
  }

}
