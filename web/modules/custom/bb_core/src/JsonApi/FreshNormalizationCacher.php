<?php

declare(strict_types=1);

namespace Drupal\bb_core\JsonApi;

use Drupal\bb_core\Hook\LoadedEntityChecksumHooks;
use Drupal\jsonapi\EventSubscriber\ResourceObjectNormalizationCacher;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Symfony\Component\HttpKernel\Event\TerminateEvent;

/**
 * Skips caching a normalization whose entity changed while it was being read.
 *
 * Core writes the pending normalizations at terminate with the current tag
 * checksum, so a write that landed between the load and terminate would leave
 * the old normalization cached until the next write.
 */
final class FreshNormalizationCacher extends ResourceObjectNormalizationCacher {

  /**
   * The load-time checksums of this request.
   */
  private LoadedEntityChecksumHooks $loadedEntityChecksums;

  /**
   * Sets the load-time checksums.
   */
  public function setLoadedEntityChecksums(LoadedEntityChecksumHooks $loaded_entity_checksums): void {
    $this->loadedEntityChecksums = $loaded_entity_checksums;
  }

  /**
   * {@inheritdoc}
   */
  public function onTerminate(TerminateEvent $event): void {
    if ($this->toCache) {
      $this->loadedEntityChecksums->refresh();
    }
    parent::onTerminate($event);
  }

  /**
   * {@inheritdoc}
   */
  protected function set(ResourceObject $object, array $normalization_parts): void {
    if ($this->loadedEntityChecksums->changedSinceLoad($object->getResourceType()->getEntityTypeId(), $object->getId())) {
      return;
    }
    parent::set($object, $normalization_parts);
  }

}
