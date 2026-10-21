<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\Component\Utility\UrlHelper;

/**
 * The Project Board address: chosen facets, parent focus and work states.
 *
 * Every link drops `page`, which holds all four column pagers, so a changed
 * selection never lands on a page that no longer exists. Work state chips
 * default to the three open columns; Done joins them only when chosen.
 */
final class BoardAddress {

  /**
   * Open work states: active on an address that does not name work_state.
   */
  public const OPEN_WORK_STATES = ['not_assigned', 'intake', 'working'];

  /**
   * The exposed identifiers "Clear filters" removes; parent stays.
   */
  private const CLEARABLE = ['state', 'assignee', 'priority', 'title', 'work_state'];

  /**
   * Builds the address of one board request.
   *
   * @param string $path
   *   The board path, with base URL.
   * @param array<string, mixed> $query
   *   The request's query parameters.
   * @param array<string, mixed> $input
   *   The view's exposed input.
   */
  public function __construct(
    private readonly string $path,
    private readonly array $query,
    private readonly array $input = [],
  ) {}

  /**
   * Whether this address currently shows the Done column.
   */
  public function showsDone(): bool {
    return in_array('done', $this->active('work_state'), TRUE);
  }

  /**
   * The values of one exposed facet in the request.
   *
   * Work state with no query key is the three open columns, so those chips
   * render active without writing work_state into a first visit.
   *
   * @return list<string>
   *   The active values, without the "nothing chosen" sentinels.
   */
  public function active(string $identifier): array {
    if ($identifier === 'work_state' && !array_key_exists('work_state', $this->query)) {
      return self::OPEN_WORK_STATES;
    }
    $raw = $this->input[$identifier] ?? $this->query[$identifier] ?? [];
    $values = is_array($raw) ? $raw : [$raw];
    return array_values(array_filter(
      array_map(strval(...), array_filter($values, 'is_scalar')),
      static fn (string $value): bool => $value !== '' && $value !== 'All',
    ));
  }

  /**
   * The address with one facet value toggled.
   *
   * Parent is exclusive: picking another parent replaces the current one,
   * picking the active parent clears it. Other identifiers accumulate.
   */
  public function toggle(string $identifier, string $value): string {
    $query = $this->query;
    unset($query['page'], $query[$identifier]);
    if ($identifier === 'parent_id') {
      if (!in_array($value, $this->active($identifier), TRUE)) {
        $query[$identifier] = $value;
      }
      return $this->with($query);
    }
    $values = $this->active($identifier);
    $values = in_array($value, $values, TRUE)
      ? array_values(array_diff($values, [$value]))
      : [...$values, $value];
    if ($identifier === 'work_state' && $this->isOpenWorkStateDefault($values)) {
      return $this->with($query);
    }
    if ($values !== []) {
      $query[$identifier] = $values;
    }
    return $this->with($query);
  }

  /**
   * Whether these work states are the three open columns, in any order.
   *
   * @param list<string> $values
   *   The work_state values after a toggle.
   */
  private function isOpenWorkStateDefault(array $values): bool {
    $expected = self::OPEN_WORK_STATES;
    sort($expected);
    $actual = $values;
    sort($actual);
    return $actual === $expected;
  }

  /**
   * The address with every filter but the parent cleared.
   *
   * NULL when nothing clearable is chosen, so the link never points at the
   * current address. Dropping work_state restores the three open chips.
   */
  public function clear(): ?string {
    $active = array_filter(
      array_intersect_key($this->query, array_flip(self::CLEARABLE)),
      static fn (mixed $value): bool => $value !== '' && $value !== 'All' && $value !== [],
    );
    if (isset($active['work_state']) && $this->isOpenWorkStateDefault($this->active('work_state'))) {
      unset($active['work_state']);
    }
    if ($active === []) {
      return NULL;
    }
    $query = [];
    $parent = $this->query['parent_id'] ?? '';
    if (is_string($parent) && $parent !== '') {
      $query['parent_id'] = $parent;
    }
    return $this->with($query);
  }

  /**
   * The board path with a query.
   *
   * @param array<string, mixed> $query
   *   The query parameters.
   */
  private function with(array $query): string {
    return $query === [] ? $this->path : $this->path . '?' . UrlHelper::buildQuery($query);
  }

}
