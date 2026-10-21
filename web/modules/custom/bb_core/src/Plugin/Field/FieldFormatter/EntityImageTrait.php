<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\file\FileInterface;
use Drupal\image\ImageStyleInterface;

/**
 * The URL of an entity's cropped `image`, only where the reader may see it.
 *
 * Shared by the listing avatar, the workspace switcher, the home chooser and
 * the invitation so one rule decides when a project, group or workspace image
 * is shown: field view access and file download access, with both results'
 * cache metadata collected. The URL is the `avatar` derivative, which applies
 * the file's saved square crop; the derivative's own download re-checks the
 * original file's access.
 */
trait EntityImageTrait {

  /**
   * The accessible image URL, or '' for initials.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The project, group or workspace.
   * @param \Drupal\Core\Cache\CacheableMetadata $cache
   *   Receives the access results, the entity, the file and the style.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   Loads the `avatar` image style.
   */
  protected function entityImageUrl(EntityInterface $entity, CacheableMetadata $cache, EntityTypeManagerInterface $entity_type_manager): string {
    $cache->addCacheableDependency($entity);
    if (!$entity instanceof FieldableEntityInterface || !$entity->hasField('image')) {
      return '';
    }
    $field_access = $entity->get('image')->access('view', NULL, TRUE);
    $cache->addCacheableDependency($field_access);
    $file = $entity->get('image')->entity;
    if (!$field_access->isAllowed() || !$file instanceof FileInterface) {
      return '';
    }
    $file_access = $file->access('download', NULL, TRUE);
    $cache->addCacheableDependency($file_access)->addCacheableDependency($file);
    if (!$file_access->isAllowed()) {
      return '';
    }
    $style = $entity_type_manager->getStorage('image_style')->load('avatar');
    if (!$style instanceof ImageStyleInterface) {
      return '';
    }
    // buildUrl() is absolute: the cached markup varies by host.
    $cache->addCacheableDependency($style)->addCacheContexts(['url.site']);
    return $style->buildUrl((string) $file->getFileUri());
  }

}
