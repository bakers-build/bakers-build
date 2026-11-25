<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\search_api\Query\ResultSetInterface;

/**
 * Filters and counts readable tickets on the ticket index.
 *
 * The index's read-scope processor narrows every query to the current user's
 * projects, so rows, total and facet counts share one scope.
 */
final class TicketFacetSearch {

  /**
   * Facet names and the index field each counts.
   */
  private const FACETS = [
    'conductor' => 'conductor_id',
    'project' => 'project_id',
    'state' => 'state',
    'attention' => 'attention',
  ];

  /**
   * Attention values and their labels.
   */
  private const ATTENTION = [
    'review' => 'Review',
    'plan_ready' => 'Plan ready',
    'question' => 'Question',
  ];

  /**
   * Rows returned at most.
   */
  private const LIMIT = 50;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * Runs one filtered, faceted index query.
   *
   * @param array<string, mixed> $filters
   *   Keys conductor (UUIDs), conductor_owner ("me"), state and attention
   *   (lists, any matches), closed and frozen (booleans); all must hold.
   * @param list<string> $facets
   *   Facet names from self::FACETS.
   * @param int|null $projectId
   *   A readable project to stay within, or NULL for all readable ones.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account behind "me" and the conductor read check.
   *
   * @return array{ids: list<int>, total: int, facets: array<string, list<array<string, mixed>>>}
   *   Ticket ids newest first, the match count and the buckets per facet.
   *
   * @throws \InvalidArgumentException
   *   On an unknown or empty filter, value or facet.
   */
  public function search(array $filters, array $facets, ?int $projectId, AccountInterface $account): array {
    $unknown = array_diff($facets, array_keys(self::FACETS));
    if ($unknown) {
      throw new \InvalidArgumentException(sprintf('Unknown facet %s; use %s.', implode(', ', $unknown), implode(', ', array_keys(self::FACETS))));
    }
    $index = $this->entityTypeManager->getStorage('search_api_index')->load('bb_tickets');
    if ($index === NULL) {
      throw new \InvalidArgumentException('The ticket index is not available; search with query or branch_name.');
    }
    $query = $index->query();
    foreach ($this->conditions($filters, $account) as [$field, $value, $operator]) {
      $query->addCondition($field, $value, $operator);
    }
    if ($projectId !== NULL) {
      $query->addCondition('project_id', $projectId);
    }
    if ($facets) {
      $query->setOption('search_api_facets', array_map(static fn (string $facet): array => [
        'field' => self::FACETS[$facet],
        'limit' => 0,
        'min_count' => 1,
        'missing' => FALSE,
        'operator' => 'and',
      ], array_combine($facets, $facets)));
    }
    $query->sort('ticket_id', 'DESC');
    $query->range(0, self::LIMIT);
    return $this->answer($query->execute(), $facets);
  }

  /**
   * Rows, total and buckets of an executed query.
   *
   * @param \Drupal\search_api\Query\ResultSetInterface $results
   *   The results.
   * @param list<string> $facets
   *   The asked facets.
   *
   * @return array{ids: list<int>, total: int, facets: array<string, list<array<string, mixed>>>}
   *   As search() returns.
   */
  private function answer(ResultSetInterface $results, array $facets): array {
    $ids = [];
    foreach (array_keys($results->getResultItems()) as $item) {
      // An item id is entity:bb_ticket/<id>:<langcode>.
      $ids[] = (int) explode(':', explode('/', $item)[1] ?? '')[0];
    }
    $raw = $results->getExtraData('search_api_facets', []);
    $buckets = [];
    foreach ($facets as $facet) {
      $counts = [];
      foreach ($raw[$facet] ?? [] as $row) {
        $value = trim((string) $row['filter'], '"');
        // An empty attention is indexed as '', and needs no bucket.
        if ($value !== '') {
          $counts[$value] = (int) $row['count'];
        }
      }
      $buckets[$facet] = $this->buckets($facet, $counts);
    }
    return ['ids' => $ids, 'total' => (int) $results->getResultCount(), 'facets' => $buckets];
  }

  /**
   * The index conditions the filters ask for.
   *
   * @param array<string, mixed> $filters
   *   The filters.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account behind "me".
   *
   * @return list<array{string, mixed, string}>
   *   Field, value and operator per condition.
   */
  private function conditions(array $filters, AccountInterface $account): array {
    $conditions = [];
    foreach ($filters as $key => $value) {
      $conditions[] = match ($key) {
        'conductor' => ['conductor_id', $this->conductorIds($this->list($key, $value), $account), 'IN'],
        'conductor_owner' => $value === 'me'
          ? ['conductor_owner_user_id', (int) $account->id(), '=']
          : throw new \InvalidArgumentException(sprintf('conductor_owner takes only "me", not "%s".', is_scalar($value) ? $value : gettype($value))),
        'state' => ['state', $this->known($key, $this->list($key, $value), self::states()), 'IN'],
        'attention' => ['attention', $this->known($key, $this->list($key, $value), array_keys(self::ATTENTION)), 'IN'],
        // The database backend stores booleans as 0 and 1.
        'closed', 'frozen' => is_bool($value)
          ? [$key, (int) $value, '=']
          : throw new \InvalidArgumentException(sprintf('%s takes true or false.', $key)),
        default => throw new \InvalidArgumentException(sprintf('Unknown filter %s; use conductor, conductor_owner, state, attention, closed or frozen.', $key)),
      };
    }
    return $conditions;
  }

  /**
   * The workflow state ids.
   *
   * @return list<string>
   *   State ids.
   */
  private static function states(): array {
    return array_map('strval', array_keys(TypeWorkflows::ticketStateOptions()));
  }

  /**
   * A filter's non-empty list of strings.
   *
   * @return list<string>
   *   The values.
   */
  private function list(string $key, mixed $value): array {
    if (!is_array($value) || $value === []) {
      throw new \InvalidArgumentException(sprintf('%s takes a non-empty list.', $key));
    }
    return array_values(array_map('strval', $value));
  }

  /**
   * The values, each one of the allowed.
   *
   * @param string $key
   *   The filter name.
   * @param list<string> $values
   *   The given values.
   * @param list<string> $allowed
   *   The allowed values.
   *
   * @return list<string>
   *   The values.
   */
  private function known(string $key, array $values, array $allowed): array {
    $unknown = array_diff($values, $allowed);
    if ($unknown) {
      throw new \InvalidArgumentException(sprintf('Unknown %s %s; use %s.', $key, implode(', ', $unknown), implode(', ', $allowed)));
    }
    return $values;
  }

  /**
   * Conductor ids for UUIDs the account may read, in a project it may read.
   *
   * @param list<string> $uuids
   *   Conductor UUIDs.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The reader.
   *
   * @return list<int>
   *   Conductor ids.
   */
  private function conductorIds(array $uuids, AccountInterface $account): array {
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    $found = [];
    foreach ($storage->loadByProperties(['uuid' => $uuids]) as $conductor) {
      $project = $conductor instanceof ContentEntityInterface ? $conductor->get('project_id')->entity : NULL;
      if ($conductor->access('view', $account) && $project instanceof EntityInterface && $project->access('view', $account)) {
        $found[$conductor->uuid()] = (int) $conductor->id();
      }
    }
    $missing = array_diff($uuids, array_keys($found));
    if ($missing) {
      throw new \InvalidArgumentException(sprintf('Conductor %s does not exist or is not readable.', implode(', ', $missing)));
    }
    return array_values($found);
  }

  /**
   * The buckets of one facet, most tickets first, then by label.
   *
   * @param string $facet
   *   The facet name.
   * @param array<string, int> $counts
   *   Ticket counts by indexed value.
   *
   * @return list<array<string, mixed>>
   *   One bucket per value.
   */
  private function buckets(string $facet, array $counts): array {
    $buckets = match ($facet) {
      'conductor' => $this->conductorBuckets($counts),
      'project' => $this->entityBuckets('bb_project', $counts),
      'state' => $this->labelBuckets(TypeWorkflows::ticketStateOptions(), $counts),
      'attention' => $this->labelBuckets(self::ATTENTION, $counts),
      default => [],
    };
    usort($buckets, static fn (array $a, array $b): int => [$b['count'], $a['label']] <=> [$a['count'], $b['label']]);
    return $buckets;
  }

  /**
   * Buckets labelled from a fixed list.
   *
   * @param array<string, string> $labels
   *   Labels by value.
   * @param array<string, int> $counts
   *   Counts by value.
   *
   * @return list<array<string, mixed>>
   *   The buckets.
   */
  private function labelBuckets(array $labels, array $counts): array {
    $buckets = [];
    foreach ($counts as $value => $count) {
      $value = (string) $value;
      $buckets[] = ['value' => $value, 'label' => $labels[$value] ?? $value, 'count' => $count];
    }
    return $buckets;
  }

  /**
   * Buckets of entities by id, valued by UUID.
   *
   * @param string $type
   *   The entity type.
   * @param array<string, int> $counts
   *   Counts by entity id.
   *
   * @return list<array<string, mixed>>
   *   The buckets.
   */
  private function entityBuckets(string $type, array $counts): array {
    $buckets = [];
    foreach ($this->entityTypeManager->getStorage($type)->loadMultiple(array_keys($counts)) as $id => $entity) {
      $buckets[] = ['value' => $entity->uuid(), 'label' => (string) $entity->label(), 'count' => $counts[$id]];
    }
    return $buckets;
  }

  /**
   * Conductor buckets with the owner and the machine.
   *
   * @param array<string, int> $counts
   *   Counts by conductor id.
   *
   * @return list<array<string, mixed>>
   *   The buckets.
   */
  private function conductorBuckets(array $counts): array {
    $buckets = [];
    foreach ($this->entityTypeManager->getStorage('bb_conductor')->loadMultiple(array_keys($counts)) as $id => $conductor) {
      assert($conductor instanceof ContentEntityInterface);
      $owner = $conductor->get('owner_user_id')->entity;
      $machine = $conductor->get('machine')->entity;
      $buckets[] = [
        'value' => $conductor->uuid(),
        'label' => (string) $conductor->label(),
        'count' => $counts[$id],
        // A deleted owner or machine leaves a dangling id: null, not a fatal.
        'owner' => $owner ? ['uuid' => $owner->uuid(), 'name' => (string) $owner->label()] : NULL,
        'machine' => $machine ? ['uuid' => $machine->uuid(), 'name' => (string) $machine->label()] : NULL,
      ];
    }
    return $buckets;
  }

}
