<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Cache\CacheTagsChecksumInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Remembers the cache tag checksum of each entity a JSON:API read loads.
 *
 * A write from another request between that load and the read's terminate
 * leaves the read holding an old entity; the JSON:API normalization cacher asks
 * this class so it never caches that old normalization under the new checksum.
 */
final class LoadedEntityChecksumHooks {

  /**
   * Cache tags and their checksum at load, keyed by entity type id and uuid.
   *
   * @var array<string, array{0: string[], 1: int|string}>
   */
  private array $atLoad = [];

  public function __construct(
    private readonly RequestStack $requestStack,
    #[Autowire(service: 'cache_tags.invalidator.checksum')]
    private readonly CacheTagsChecksumInterface $checksum,
  ) {}

  /**
   * Records the loaded entities of a cacheable JSON:API request.
   *
   * @param array<\Drupal\Core\Entity\EntityInterface> $entities
   *   The loaded entities.
   */
  #[Hook('entity_load')]
  public function entityLoad(array $entities): void {
    $request = $this->requestStack->getCurrentRequest();
    if (!$request?->isMethodCacheable() || !$request->attributes->get('_is_jsonapi')) {
      return;
    }
    foreach ($entities as $entity) {
      if ($entity instanceof ContentEntityInterface && $entity->uuid() !== NULL) {
        // The first load counts: a later one may already hold the new state.
        $tags = $entity->getCacheTags();
        $this->atLoad[$this->key($entity->getEntityTypeId(), (string) $entity->uuid())] ??= [
          $tags,
          $this->checksum->getCurrentChecksum($tags),
        ];
      }
    }
  }

  /**
   * Whether the entity's cache tags changed since this request loaded it.
   *
   * Call refresh() first, so invalidations by other requests are seen.
   */
  public function changedSinceLoad(string $entityTypeId, string $uuid): bool {
    $loaded = $this->atLoad[$this->key($entityTypeId, $uuid)] ?? NULL;
    return $loaded !== NULL && $this->checksum->getCurrentChecksum($loaded[0]) != $loaded[1];
  }

  /**
   * Drops this request's static tag counts, so the next checksum reads storage.
   */
  public function refresh(): void {
    $this->checksum->reset();
  }

  /**
   * The record key of one entity.
   */
  private function key(string $entityTypeId, string $uuid): string {
    return $entityTypeId . ':' . $uuid;
  }

}
