<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\island\Entity\App;

/**
 * Selects and renders an app profile around the current page content.
 *
 * This is deliberately a small integration seam. Controllers opt into it when
 * an app owns page composition; when no profile matches it returns the normal
 * controller result unchanged.
 */
final class IslandAppPageBuilder {

  public function __construct(
    private readonly IslandProfileSelector $selector,
    private readonly IslandProfileRenderer $renderer,
  ) {
  }

  /**
   * Renders the selected profile or returns the supplied page content.
   *
   * @param \Drupal\island\Entity\App $app
   *   The app that owns the page composition.
   * @param array<string, mixed> $page_content
   *   The ordinary controller render array.
   * @param string $instance_id
   *   Runtime scope for repeated app instances.
   *
   * @return array<string, mixed>
   *   The profile or original page render array.
   */
  public function build(App $app, array $page_content, string $instance_id = 'default'): array {
    $cache = new CacheableMetadata();
    $profile = $this->selector->select($app, $cache);
    $build = $profile === NULL ? $page_content : $this->renderer->render($profile, $instance_id, ['content' => $page_content]);
    $cache->merge(CacheableMetadata::createFromRenderArray($build))->applyTo($build);
    return $build;
  }

}
