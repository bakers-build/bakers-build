<?php

declare(strict_types=1);

namespace Drupal\island_example\Controller;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandWrapper;
use Drupal\island_example\TaskHostProvider;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Demo pages hosting the task islands.
 */
final class TasksController implements ContainerInjectionInterface {

  public function __construct(
    protected TaskHostProvider $hostProvider,
    protected IslandPluginManagerInterface $islandManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('island_example.host'),
      $container->get('plugin.manager.island'),
    );
  }

  /**
   * Task list page: list and counter islands under the demo chrome.
   */
  public function page(): array {
    return $this->chromePage();
  }

  /**
   * Task detail page: the detail island under the demo chrome.
   *
   * The route's `{task_id}` is named in the signature because the route
   * declares it, and read through the host seam rather than from here — the
   * host is what decides an island's data for the request, and reading the id
   * twice would give the demo two sources for one answer.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function detail(string $task_id): array {
    $host = $this->hostProvider;
    if ($host->getIslandData('task_detail')['task'] === NULL) {
      throw new NotFoundHttpException();
    }
    return $this->chromePage();
  }

  /**
   * Notes page: the entity-form note island under the demo chrome.
   */
  public function notes(): array {
    return $this->chromePage();
  }

  /**
   * The page-container link demo: content only, no chrome and no rail.
   *
   * A linkToPage() link targets a container the PAGE owns, written by the
   * theme's page template and therefore absent from the response fragment
   * (spec M2). This page contributes nothing outside its own main content, so
   * the swap has exactly one container to land in and cannot nest a region
   * inside itself.
   */
  public function pageLink(): array {
    return [
      '#cache' => ['max-age' => 0],
      '#attached' => ['library' => ['island/base']],
      'link' => $this->renderIsland('page_link'),
    ];
  }

  /**
   * The page-container link's destination: a marker and nothing else.
   */
  public function pageLinkTarget(): array {
    return [
      '#cache' => ['max-age' => 0],
      'arrived' => [
        '#type' => 'html_tag',
        '#tag' => 'span',
        '#attributes' => ['data-testid' => 'page-link-arrived'],
        '#value' => 'Arrived',
      ],
    ];
  }

  /**
   * A page the internal page cache will actually store (BB-408 R1).
   *
   * The whole hazard needs an anonymously cacheable page carrying an island,
   * and until now the demo had none: every route is marked `no_cache` because
   * its pages embed session-bound CSRF tokens. This page holds a constant and
   * a marker, so a plain visit stores it — after which a boosted request
   * against the same url must neither be answered from that entry nor
   * overwrite it.
   */
  public function cacheablePage(): array {
    return [
      'marker' => [
        '#type' => 'html_tag',
        '#tag' => 'span',
        '#attributes' => ['data-testid' => 'cacheable-page'],
        '#value' => 'whole page',
      ],
      'island' => $this->renderIsland('cacheable'),
    ];
  }

  /**
   * Renders one island in its stable wrapper.
   *
   * The declaration is ASKED FOR, never composed here. A host that applied one
   * of its own would be a second author: the boosted GET path renders the same
   * island without ever running this controller, so the page and the fragment
   * would then agree only for as long as somebody kept two call sites in step.
   */
  private function renderIsland(string $island_id): array {
    $host = $this->hostProvider;
    $config = $host->getIslandConfiguration($island_id);
    $config['contexts']['host'] = $host;
    $island = $this->islandManager->createInstance($island_id, $config);
    if (!$island instanceof IslandInterface) {
      throw new \LogicException(sprintf('Island plugin "%s" does not implement IslandInterface.', $island_id));
    }
    return IslandWrapper::wrap(
      $island->getHtmlId($host->hostId()),
      $island->build($host->getIslandData($island_id)),
      FALSE,
      $island->boost(),
    );
  }

  /**
   * Demo page skeleton: chrome marker, the rail, and the content region.
   *
   * The static `chrome` marker stays: link.spec.ts asserts it survives a
   * fragment navigation untouched, and that is the regression net for the
   * "content only" claim. The rail beside it is the island that authors its
   * own links; it sits outside the content region, so a rail link swaps the
   * region below it and leaves the rail itself standing.
   *
   * Both islands carry a client declaration (BB-408), and the two say
   * different things because they mean different things:
   *
   * - The rail targets the content region, so it declares ITSELF as the
   *   fragment that rides along — one request, two islands, and the active
   *   entry is right afterwards because the rail was re-rendered too.
   * - The content region targets nothing, which means itself, and therefore
   *   declares nothing out of band. That is what makes a content click cost
   *   exactly one island.
   *
   * Neither is written here. Each island declares its own, so the same
   * declaration reaches the page build and every fragment the boosted GET
   * path renders afterwards — which the controller is not even involved in.
   *
   * Neither declaration disturbs the links the two islands ALREADY author
   * through linkToRoute(). htmx boosts an anchor only when it has no explicit
   * http action of its own, so the existing rail and list links keep their own
   * hx-get and the boost applies to the plain ones beside them. The two
   * mechanisms coexist on one page rather than competing for it.
   */
  private function chromePage(): array {
    return [
      '#cache' => ['max-age' => 0],
      '#attached' => ['library' => ['island/base']],
      'chrome' => ['#markup' => '<header data-testid="chrome">Island example</header>'],
      'rail' => $this->renderIsland('chrome'),
      'content' => $this->renderIsland('content'),
    ];
  }

}
