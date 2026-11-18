<?php

/**
 * @file
 * Deploy hooks for bb_core; `drush deploy` runs them after the config import.
 */

declare(strict_types=1);

use Drupal\search_api\Entity\Index;

/**
 * Indexes every ticket, so `?parent=` lists sub-tickets without cron.
 *
 * A deploy hook rather than a post_update: the import that adds the
 * `parent_identifier` field runs after `updb`.
 *
 * @param array<string, mixed> $sandbox
 *   The batch state.
 */
function bb_core_deploy_index_ticket_parents(array &$sandbox): string {
  $index = \Drupal::moduleHandler()->moduleExists('search_api') ? Index::load('bb_tickets') : NULL;
  if ($index === NULL || !$index->status() || $index->getField('parent_identifier') === NULL) {
    $sandbox['#finished'] = 1;
    return 'No ticket index with a parent field; nothing to index.';
  }
  if (!isset($sandbox['indexed'])) {
    $index->reindex();
    $sandbox['indexed'] = 0;
  }
  $indexed = $index->indexItems(100);
  $sandbox['indexed'] += $indexed;
  $tracker = $index->getTrackerInstance();
  $total = $tracker->getTotalItemsCount();
  $remaining = $tracker->getRemainingItemsCount();
  // A pass that indexes nothing ends the hook, so a failing item cannot loop.
  $sandbox['#finished'] = $indexed === 0 || $remaining === 0 || $total === 0 ? 1 : 1 - $remaining / $total;
  return sprintf('Indexed %d tickets for the parent filter.', $sandbox['indexed']);
}
