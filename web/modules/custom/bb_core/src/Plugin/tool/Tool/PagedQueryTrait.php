<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Entity\Query\QueryInterface;

/**
 * Bounded `limit`/`offset` paging for list tools.
 *
 * Tools declare optional integer inputs `limit` (1-100, default 50) and
 * `offset` (default 0) and return `next_offset`, NULL on the last page.
 */
trait PagedQueryTrait {

  /**
   * Runs one page of an access-checked, sorted query.
   *
   * @param \Drupal\Core\Entity\Query\QueryInterface $query
   *   The query, already filtered and sorted.
   * @param array<string, mixed> $values
   *   The tool inputs.
   *
   * @return array{0: array<int|string>, 1: int|null}
   *   The page's entity ids and the next offset, NULL when none is left.
   *
   * @throws \InvalidArgumentException
   */
  protected function page(QueryInterface $query, array $values): array {
    $limit = (int) ($values['limit'] ?? 50);
    $offset = (int) ($values['offset'] ?? 0);
    if ($limit < 1 || $limit > 100 || $offset < 0) {
      throw new \InvalidArgumentException('limit must be 1-100 and offset 0 or more.');
    }
    // One extra row tells whether another page exists without a count query.
    $ids = $query->range($offset, $limit + 1)->execute();
    assert(is_array($ids));
    $ids = array_values($ids);
    $more = count($ids) > $limit;
    return [array_slice($ids, 0, $limit), $more ? $offset + $limit : NULL];
  }

}
