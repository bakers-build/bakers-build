<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Project\OriginSource;

/**
 * Computes the distinct sources of a project's tickets' Origin URLs.
 *
 * Read per request from the tickets the current user may view, sorted by
 * label. Read-only: each ticket's `origin` stays the single source of truth.
 */
final class OriginSourcesItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $project = $this->getEntity();
    if (!$project instanceof BbProjectInterface || $project->isNew()) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->condition('origin', '', '<>')
      ->execute();
    $sources = [];
    foreach ($storage->loadMultiple($ids) as $ticket) {
      $source = $ticket instanceof BbTicketInterface ? OriginSource::fromUrl((string) $ticket->get('origin')->value) : NULL;
      if ($source !== NULL) {
        $sources[$source['url']] = $source;
      }
    }
    uasort($sources, static fn (array $a, array $b): int => $a['label'] <=> $b['label']);
    foreach (array_values($sources) as $delta => $source) {
      $this->list[$delta] = $this->createItem($delta, ['uri' => $source['url'], 'title' => $source['label']]);
    }
  }

}
