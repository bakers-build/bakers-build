<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbRunInterface;

/**
 * AC4/AC10 — links the run-log download route from a run's operations.
 *
 * Every operations listing of a bb_run picks these up with no Views change:
 * the standard extension point core ships for exactly this, rather than a
 * bespoke Views field plugin for one link.
 */
final class RunLogOperationsHooks {

  /**
   * Adds "Log" / "Error log" operations for a run with a captured log.
   *
   * @return array<string, array<string, mixed>>
   *   The operations to merge into the entity's operations list.
   */
  #[Hook('entity_operation')]
  public function entityOperation(EntityInterface $entity, CacheableMetadata $cacheability): array {
    if (!$entity instanceof BbRunInterface) {
      return [];
    }
    $cacheability->addCacheableDependency($entity);
    $log_access = $entity->access('view_log', NULL, TRUE);
    $cacheability->addCacheableDependency($log_access);
    if (!$log_access->isAllowed()) {
      return [];
    }
    $operations = [];
    foreach (['log' => 'Log', 'error_log' => 'Error log'] as $field => $label) {
      if ($entity->get($field . '_bytes')->value === NULL || $entity->get($field . '_bytes')->value === '') {
        continue;
      }
      // `run_log_download_api`, not the workspace-prefixed route (review
      // finding C2/CR1): an operations link has the run entity but no
      // resolved workspace slug in hand, and the API route's gate —
      // `bb_run.view_log` — is identical.
      $operations[$field] = [
        'title' => $label,
        'url' => Url::fromRoute('bb_core.run_log_download_api', [
          'bb_run' => $entity->uuid(),
          'kind' => $field,
        ]),
        'weight' => 100,
      ];
    }
    return $operations;
  }

}
