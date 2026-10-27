<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Measurement;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbTeamInterface;

/**
 * Converts accepted route entities into IDs used by measurement queries.
 */
final class ContextBindingResolver {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Resolves one binding against a context entity.
   *
   * @param array{resolver?: string} $binding
   *   The binding configuration.
   * @param \Drupal\Core\Entity\EntityInterface $context
   *   The context entity.
   *
   * @return array<int|string>
   *   The IDs used by the query condition.
   */
  public function resolve(array $binding, EntityInterface $context): array {
    return match ($binding['resolver'] ?? '') {
      'entity_id' => [$context->id()],
      'epic_subtree' => $this->epicSubtree($context),
      'team_projects' => $this->teamProjects($context),
      'workspace_projects' => $this->workspaceProjects($context),
      default => throw new \InvalidArgumentException(sprintf('Unknown measurement context resolver "%s".', $binding['resolver'] ?? '')),
    };
  }

  /**
   * Resolves one binding against a context entity or a restriction list.
   *
   * A restriction unites the IDs of its entities; a NULL entry stands for
   * "no entity", which admits source entities without a bound value.
   *
   * @param array{resolver?: string} $binding
   *   The binding configuration.
   * @param \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null> $context
   *   The context entity or restriction list.
   *
   * @return array{0: list<int|string>, 1: bool}
   *   The unique IDs, and whether "no entity" is admitted.
   */
  public function resolveAll(array $binding, EntityInterface|array $context): array {
    $ids = [];
    $none = FALSE;
    foreach (is_array($context) ? $context : [$context] as $entity) {
      if ($entity === NULL) {
        $none = TRUE;
        continue;
      }
      array_push($ids, ...$this->resolve($binding, $entity));
    }
    return [array_values(array_unique($ids)), $none];
  }

  /**
   * The projects inside every workspace, team and project context given.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface|array<\Drupal\Core\Entity\EntityInterface|null>> $contexts
   *   The named contexts and restriction lists.
   *
   * @return list<int|string>
   *   The project IDs; none without a workspace, team or project context.
   */
  public function projectsInScope(array $contexts): array {
    $ids = NULL;
    foreach (['workspace' => 'workspace_projects', 'team' => 'team_projects', 'project' => 'entity_id'] as $key => $resolver) {
      if (isset($contexts[$key])) {
        [$inScope] = $this->resolveAll(['resolver' => $resolver], $contexts[$key]);
        $ids = $ids === NULL ? $inScope : array_values(array_intersect($ids, $inScope));
      }
    }
    return $ids ?? [];
  }

  /**
   * Resolves an epic ticket and every ticket below it.
   *
   * @return array<int>
   *   The ticket IDs, the epic first.
   */
  private function epicSubtree(EntityInterface $context): array {
    if ($context->getEntityTypeId() !== 'bb_ticket') {
      throw new \InvalidArgumentException('The epic_subtree resolver requires a bb_ticket context.');
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $visited = [(int) $context->id()];
    $frontier = $visited;
    while ($frontier !== []) {
      $children = array_map('intval', array_values($storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('parent_id', $frontier, 'IN')
        ->execute()));
      // The visited set ends a cyclic parent chain.
      $frontier = array_values(array_diff($children, $visited));
      array_push($visited, ...$frontier);
    }
    return $visited;
  }

  /**
   * Resolves the projects assigned to a team.
   *
   * @return array<int>
   *   The project IDs.
   */
  private function teamProjects(EntityInterface $context): array {
    if (!$context instanceof BbTeamInterface) {
      throw new \InvalidArgumentException('The team_projects resolver requires a bb_team context.');
    }
    return array_map(
      static fn(EntityInterface $project): int => (int) $project->id(),
      $context->getProjects(),
    );
  }

  /**
   * Resolves all projects in a workspace.
   *
   * @return array<int>
   *   The project IDs.
   */
  private function workspaceProjects(EntityInterface $context): array {
    if ($context->getEntityTypeId() !== 'bb_workspace') {
      throw new \InvalidArgumentException('The workspace_projects resolver requires a bb_workspace context.');
    }
    $ids = $this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition('group_id.entity.workspace_id', $context->id())
      ->execute();
    return array_map('intval', array_values($ids));
  }

}
