<?php

declare(strict_types=1);

namespace Drupal\bb_core\PathProcessor;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\PathProcessor\InboundPathProcessorInterface;
use Drupal\Core\PathProcessor\OutboundPathProcessorInterface;
use Drupal\Core\Render\BubbleableMetadata;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Makes the root-level workspace segment routable in both directions.
 *
 * Drupal's router never matches a route whose first segment is a variable,
 * so routes carry a static `/_workspace/{bb_workspace}/…` prefix and this
 * processor maps `/bakers/ticket/bb-1` to and from it, the way
 * PathProcessorLanguage bridges `/de/node/1`.
 */
final class BbWorkspacePathProcessor implements InboundPathProcessorInterface, OutboundPathProcessorInterface {

  /**
   * The static first segment every workspace route really carries.
   *
   * Starts with an underscore on purpose: the slug pattern forbids one, so
   * this segment can never be mistaken for a workspace and no workspace can
   * ever be named after it.
   */
  public const PREFIX = '_workspace';

  /**
   * The cache id the slug set is memoised under.
   */
  private const CACHE_ID = 'bb_core:workspace_slugs';

  /**
   * The slug set for this request.
   *
   * @var array<string, true>|null
   */
  private ?array $slugs = NULL;

  /**
   * Constructs a BbWorkspacePathProcessor.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache
   *   The default cache bin, holding the slug set between requests.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly CacheBackendInterface $cache,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function processInbound($path, Request $request) {
    $segment = $this->firstSegment($path);
    if ($segment === '') {
      return $path;
    }
    if ($segment === self::PREFIX) {
      // The internal prefix is an implementation detail, never an address. A
      // request that names it directly must NOT serve the product page at a
      // second URL, so it is prefixed again: `_workspace` cannot satisfy the
      // {bb_workspace} slug pattern, so nothing matches and it 404s.
      return '/' . self::PREFIX . $path;
    }
    if (!isset($this->slugSet()[$segment])) {
      return $path;
    }
    return '/' . self::PREFIX . $path;
  }

  /**
   * {@inheritdoc}
   */
  public function processOutbound($path, &$options = [], ?Request $request = NULL, ?BubbleableMetadata $bubbleable_metadata = NULL) {
    $prefix = '/' . self::PREFIX;
    if ($path === $prefix) {
      return '/';
    }
    if (str_starts_with($path, $prefix . '/')) {
      return substr($path, strlen($prefix));
    }
    return $path;
  }

  /**
   * Returns the first path segment, lowercased.
   *
   * @param string $path
   *   The path to read.
   *
   * @return string
   *   The first segment, or '' when the path has none.
   */
  private function firstSegment(string $path): string {
    $trimmed = ltrim($path, '/');
    if ($trimmed === '') {
      return '';
    }
    $end = strpos($trimmed, '/');
    return mb_strtolower($end === FALSE ? $trimmed : substr($trimmed, 0, $end));
  }

  /**
   * Returns every workspace slug, as a lookup set.
   *
   * Cached in the default bin under the workspace list tag, so the common case
   * is a cache hit and creating or renaming a workspace invalidates it. This
   * runs on EVERY inbound request, product or not, so a per-request query
   * would be a tax on the whole site.
   *
   * @return array<string, true>
   *   The slugs, as keys.
   */
  private function slugSet(): array {
    if ($this->slugs !== NULL) {
      return $this->slugs;
    }
    $cached = $this->cache->get(self::CACHE_ID);
    if ($cached !== FALSE && is_array($cached->data)) {
      $this->slugs = $cached->data;
      return $this->slugs;
    }
    $slugs = [];
    $storage = $this->entityTypeManager->getStorage('bb_workspace');
    foreach ($storage->loadMultiple() as $workspace) {
      if (!$workspace instanceof BbWorkspaceInterface) {
        continue;
      }
      $slug = mb_strtolower($workspace->getSlug());
      if ($slug !== '') {
        $slugs[$slug] = TRUE;
      }
    }
    $this->cache->set(self::CACHE_ID, $slugs, CacheBackendInterface::CACHE_PERMANENT, [
      'bb_workspace_list',
    ]);
    $this->slugs = $slugs;
    return $slugs;
  }

}
