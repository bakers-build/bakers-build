<?php

declare(strict_types=1);

namespace Drupal\island_example;

use Drupal\Core\State\StateInterface;

/**
 * State-API backed task list for the island demo.
 */
final class TaskStore {

  private const KEY = 'island_example.tasks';
  private const NEXT_ID_KEY = 'island_example.next_id';

  public function __construct(
    protected StateInterface $state,
  ) {}

  /**
   * Lists all tasks.
   *
   * @return array<int, array{id: int, title: string}>
   *   The tasks, keyed by id.
   */
  public function list(): array {
    return $this->state->get(self::KEY, []);
  }

  /**
   * {@inheritdoc}
   */
  public function get(int $id): ?array {
    return $this->list()[$id] ?? NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function add(string $title): int {
    $tasks = $this->list();
    $id = $this->state->get(self::NEXT_ID_KEY, 3);
    $tasks[$id] = ['id' => $id, 'title' => $title];
    $this->state->set(self::KEY, $tasks);
    $this->state->set(self::NEXT_ID_KEY, $id + 1);
    return $id;
  }

  /**
   * {@inheritdoc}
   */
  public function delete(int $id): void {
    $tasks = $this->list();
    unset($tasks[$id]);
    $this->state->set(self::KEY, $tasks);
  }

  /**
   * {@inheritdoc}
   */
  public function count(): int {
    return count($this->list());
  }

  /**
   * Restores the two seeded tasks.
   */
  public function reset(): void {
    $this->state->set(self::KEY, [
      1 => ['id' => 1, 'title' => 'Write spec'],
      2 => ['id' => 2, 'title' => 'Write plan'],
    ]);
    $this->state->set(self::NEXT_ID_KEY, 3);
  }

}
