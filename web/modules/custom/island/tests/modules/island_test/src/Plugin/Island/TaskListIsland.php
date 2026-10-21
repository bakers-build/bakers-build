<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandResponse;

/**
   * List island with a delete action for route/controller tests.
 */
#[Island(
  id: 'task_list',
  label: new TranslatableMarkup('Task list'),
  type: 'view',
)]
final class TaskListIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return [
      'content' => [
        '#markup' => 'list:' . $data['count'],
        'actions' => [
          'delete' => $this->action('delete', [], 'Delete', TRUE),
        ],
      ],
      '#cache' => ['tags' => ['island_test:list']],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface {
    // Islands opt in per action; anything else is explicitly forbidden.
    return $action === 'delete'
      ? AccessResult::allowed()
      : AccessResult::forbidden('Unknown island action.');
  }

  /**
   * {@inheritdoc}
   */
  public function applyAction(string $action, array $parameters): IslandResponse {
    if ($action !== 'delete') {
      return parent::applyAction($action, $parameters);
    }
    return IslandResponse::make()
      ->rebuildSelf()
      ->dispatch('tasks.changed', ['count' => 2]);
  }

}
