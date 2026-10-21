<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandEvent;
use Drupal\island\IslandPluginBase;

/**
   * Subscribes to tasks.changed but intentionally stays quiet (NULL).
 */
#[Island(
  id: 'quiet',
  label: new TranslatableMarkup('Quiet island'),
  type: 'view',
)]
final class QuietIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return ['#markup' => 'quiet'];
  }

  /**
   * {@inheritdoc}
   */
  public function getSubscribedEvents(): array {
    return ['tasks.changed' => 'onTasksChanged'];
  }

  /**
   * {@inheritdoc}
   */
  public function onTasksChanged(IslandEvent $event): null {
    // NULL leaves the island untouched and never emits markup.
    return NULL;
  }

}
