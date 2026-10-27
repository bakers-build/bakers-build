<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Figure;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\bb_core\Statistics\Period\PeriodResolver;

/**
 * Validates selected figure filters and supplies their display metadata.
 *
 * An unknown filter key is an error. An unsupported period value falls back
 * to the configured default, so an old bookmark keeps opening the page. An
 * entity filter accepts only entities of the scope: the context project, else
 * the context workspace, else under a user context only the projects of that
 * user's tickets.
 */
final class FigureFilterResolver {

  /**
   * The person filter's value for tickets without an assignee.
   */
  public const UNASSIGNED = '_unassigned';

  /**
   * The entity type selected by each entity filter binding.
   */
  private const ENTITY_TYPES = ['epic' => 'bb_ticket', 'project' => 'bb_project', 'team' => 'bb_team', 'user' => 'user'];

  public function __construct(
    private readonly EntityRepositoryInterface $entityRepository,
    private readonly WorkspaceFilterScope $scope,
  ) {}

  /**
   * Resolves selected values against the configured figure filters.
   *
   * @param array<string, array<string, mixed>> $configured
   *   The figure filter configuration.
   * @param array<string, string|list<string>> $selected
   *   The values selected by the request.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts; an entity filter needs a project, workspace or user.
   *
   * @return array<string, array<string, mixed>>
   *   The resolved filter display metadata. An entity filter also carries the
   *   loaded `entities` and an `unassigned` flag.
   */
  public function resolve(array $configured, array $selected, array $contexts = []): array {
    $companions = isset($configured['period']) ? array_flip(PeriodResolver::COMPANIONS) : [];
    foreach (array_keys($selected) as $key) {
      if (!isset($configured[$key]) && !isset($companions[$key])) {
        throw new \InvalidArgumentException(sprintf('Unknown filter "%s".', $key));
      }
    }

    $resolved = [];
    foreach ($configured as $key => $filter) {
      if (($filter['type'] ?? '') === 'entities') {
        $resolved[$key] = $this->entities((string) $key, $filter, $selected[$key] ?? [], $contexts['project'] ?? $contexts['workspace'] ?? $contexts['user'] ?? NULL);
        continue;
      }
      $selectedValue = $selected[$key] ?? '';
      if (is_array($selectedValue)) {
        throw new \InvalidArgumentException(sprintf('Filter "%s" must have one value.', $key));
      }
      $allowed = array_map(static fn(array $option): string => (string) $option['value'], $filter['options'] ?? []);
      $value = (string) $selectedValue;
      if (!in_array($value, $allowed, TRUE)) {
        $value = (string) ($filter['default'] ?? '');
      }
      $resolved[$key] = [
        'label' => (string) ($filter['label'] ?? $key),
        'value' => $value,
        'options' => $filter['options'] ?? [],
      ];
    }
    return $resolved;
  }

  /**
   * The selected UUIDs an entity filter accepts in its scope.
   *
   * A page drops what the API refuses, so an old bookmark keeps opening.
   *
   * @param string $binding
   *   The filter binding: epic, project, team or user.
   * @param array<int, string> $uuids
   *   The selected UUIDs.
   * @param \Drupal\Core\Entity\EntityInterface $scope
   *   The context project or workspace, or the user whose figures are read.
   *
   * @return list<string>
   *   The accepted UUIDs, in their selected order.
   */
  public function accepted(string $binding, array $uuids, EntityInterface $scope): array {
    $accepted = [];
    foreach (array_unique($uuids) as $uuid) {
      if ($binding === 'user' && $uuid === self::UNASSIGNED) {
        $accepted[] = $uuid;
        continue;
      }
      $entity = isset(self::ENTITY_TYPES[$binding]) ? $this->entityRepository->loadEntityByUuid(self::ENTITY_TYPES[$binding], $uuid) : NULL;
      if ($entity !== NULL && $this->scope->contains($scope, $entity)) {
        $accepted[] = $uuid;
      }
    }
    return $accepted;
  }

  /**
   * Resolves one entity filter against the context project, workspace or user.
   *
   * @param string $key
   *   The filter key.
   * @param array<string, mixed> $filter
   *   The filter configuration.
   * @param string|list<string> $value
   *   The selected UUIDs.
   * @param \Drupal\Core\Entity\EntityInterface|null $scope
   *   The context project or workspace, or the user whose figures are read.
   *
   * @return array<string, mixed>
   *   The resolved filter.
   */
  private function entities(string $key, array $filter, string|array $value, ?EntityInterface $scope): array {
    $binding = (string) $filter['binding'];
    $uuids = [];
    $entities = [];
    $unassigned = FALSE;
    foreach (array_unique(array_filter((array) $value, static fn(string $uuid): bool => $uuid !== '')) as $uuid) {
      if ($binding === 'user' && $uuid === self::UNASSIGNED) {
        $unassigned = TRUE;
        $uuids[] = $uuid;
        continue;
      }
      $entity = $this->entityRepository->loadEntityByUuid(self::ENTITY_TYPES[$binding], $uuid);
      if ($entity === NULL || $scope === NULL || !$this->scope->contains($scope, $entity)) {
        throw new \InvalidArgumentException(sprintf('Filter "%s" does not accept "%s" in this scope.', $key, $uuid));
      }
      $uuids[] = $uuid;
      $entities[] = $entity;
    }
    return [
      'label' => (string) ($filter['label'] ?? $key),
      'type' => 'entities',
      'binding' => $binding,
      'value' => $uuids,
      'entities' => $entities,
      'unassigned' => $unassigned,
    ];
  }

}
