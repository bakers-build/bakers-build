<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandEvent;
use Drupal\island\IslandPluginBase;

/**
   * Counter island re-rendered OOB on the tasks.changed event.
 */
#[Island(
  id: 'task_count',
  label: new TranslatableMarkup('Task count'),
  type: 'view',
)]
final class TaskCountIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return ['#markup' => 'count:' . $data['count']];
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
  public function onTasksChanged(IslandEvent $event): array {
    return ['#markup' => 'count:' . $event->payload['count']];
  }

}
