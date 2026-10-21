<?php

declare(strict_types=1);

namespace Drupal\island_example;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandViewAccessInterface;
use Drupal\island_example\Entity\Note;

/**
 * Host seam for the task demo islands.
 */
final class TaskHostProvider implements IslandContextProviderInterface, IslandViewAccessInterface {

  public function __construct(
    protected TaskStore $taskStore,
    protected RouteMatchInterface $currentRouteMatch,
    protected EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'tasks';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return ['task_list', 'task_count', 'task_detail', 'note', 'chrome', 'content', 'cacheable'];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(string $island_id): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    if ($island_id === 'chrome') {
      // Computed from the route of the request being served, on every build.
      // The island remembers nothing; the active entry is derived the way a
      // menu block derives its active trail.
      return [
        'active' => match ($this->currentRouteMatch->getRouteName()) {
          'island_example.notes' => 'Notes',
          default => 'Tasks',
        },
      ];
    }
    if ($island_id === 'content') {
      // Which islands this request's content region holds. Deciding that from
      // the route is the HOST's job and always was — the controller used to do
      // it by passing children in, and moving it here is what lets the content
      // region be re-rendered on its own from an html id alone.
      return [
        'islands' => match ($this->currentRouteMatch->getRouteName()) {
          'island_example.notes' => ['note'],
          'island_example.task' => ['task_detail'],
          'island_example.block' => [],
          default => ['task_list', 'task_count'],
        },
      ];
    }
    if ($island_id === 'task_detail') {
      $task_id = (int) $this->currentRouteMatch->getParameter('task_id');
      return ['task' => $this->taskStore->get($task_id)];
    }
    if ($island_id === 'note') {
      return ['note' => $this->firstNote()];
    }
    return ['tasks' => $this->taskStore->list()];
  }

  /**
   * {@inheritdoc}
   *
   * The demo's pages are public and its islands hold nothing private, so this
   * host allows all of them. It is stated rather than inherited: the boosted
   * GET path forbids a host that declares nothing, and a demo that leaned on
   * that default would not demonstrate the seam a real host has to write.
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface {
    return AccessResult::allowed();
  }

  /**
   * Loads the demo note (the first one by id), freshly from storage.
   */
  private function firstNote(): ?Note {
    $storage = $this->entityTypeManager->getStorage('island_example_note');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->sort('id')
      ->range(0, 1)
      ->execute();
    if ($ids === []) {
      return NULL;
    }
    $note = $storage->load((int) reset($ids));
    return $note instanceof Note ? $note : NULL;
  }

}
