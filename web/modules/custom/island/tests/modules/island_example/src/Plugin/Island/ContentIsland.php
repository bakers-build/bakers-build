<?php

declare(strict_types=1);

namespace Drupal\island_example\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandBoost;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandWrapper;

/**
 * The demo's swappable content region, as an island (BB-408 Task 9).
 *
 * It used to be a bare container that TasksController filled per route. Making
 * it an island is what lets the client name it: `#island-tasks-content` is now
 * an address the server can resolve, which is the whole client-declared update
 * path in one object.
 *
 * Its own html id is `island-tasks-content`, because the host is `tasks` and
 * the plugin id is `content` — the same convention every other island follows,
 * so the selector every rail link already used keeps working unchanged.
 *
 * It renders whatever the host says this request's content is, and it decides
 * nothing itself: the route-to-content answer belongs to the host, which is
 * where a host's own knowledge is allowed to live.
 *
 * The three links below are PLAIN — no htmx attribute of any kind. They are
 * the fixture for the boosted path: the container carries the declaration and
 * the links carry nothing, which is the claim, and an external link and a bare
 * `#` anchor are here so that "htmx already excludes both" is measured rather
 * than asserted.
 */
#[Island(
  id: 'content',
  label: new TranslatableMarkup('Content region'),
  type: 'view',
)]
final class ContentIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $build = ['#cache' => ['max-age' => 0]];
    foreach ((array) ($data['islands'] ?? []) as $island_id) {
      $fragment = $this->renderChild((string) $island_id);
      if ($fragment !== NULL) {
        $build[$island_id] = $fragment;
      }
    }
    return $build + $this->plainLinks();
  }

  /**
   * {@inheritdoc}
   *
   * No argument: the links inside the content region replace the content
   * region. An island is already the main fragment of its own swap and cannot
   * ride along with itself, so this declares nothing out of band — which is
   * what makes a content click cost exactly one island.
   */
  public function boost(): IslandBoost {
    return IslandBoost::to();
  }

  /**
   * Renders one child island in its own stable wrapper.
   */
  private function renderChild(string $island_id): ?array {
    $host = $this->host();
    if ($host === NULL) {
      return NULL;
    }
    $configuration = $host->getIslandConfiguration($island_id);
    $configuration['contexts']['host'] = $host;
    $island = $this->islandManager->createInstance($island_id, $configuration);
    if (!$island instanceof IslandInterface) {
      return NULL;
    }
    return IslandWrapper::wrap(
      $island->getHtmlId($host->hostId()),
      $island->build($host->getIslandData($island_id)),
      FALSE,
      $island->boost(),
    );
  }

  /**
   * The plain links the boosted container owns.
   *
   * @return array
   *   Render array children.
   */
  private function plainLinks(): array {
    return [
      // A boosted click on this one costs exactly ONE island: the container it
      // lands in is the container it was clicked in, and an island does not
      // ride along with itself.
      'boost_tasks' => [
        '#type' => 'link',
        '#title' => 'Back to tasks',
        '#url' => Url::fromRoute('island_example.tasks'),
        '#attributes' => ['data-testid' => 'content-boost-tasks'],
      ],
      // Excluded by htmx's own isLocalLink(): a different hostname.
      'external' => [
        '#type' => 'link',
        '#title' => 'External',
        '#url' => Url::fromUri('https://example.com/'),
        '#attributes' => ['data-testid' => 'content-external'],
      ],
      // Excluded by the same function: an href beginning with '#'.
      'anchor' => [
        '#type' => 'html_tag',
        '#tag' => 'a',
        '#attributes' => ['href' => '#island-tasks-content', 'data-testid' => 'content-anchor'],
        '#value' => 'Anchor',
      ],
    ];
  }

}
