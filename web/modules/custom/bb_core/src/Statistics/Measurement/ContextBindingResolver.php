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
      'team_projects' => $this->teamProjects($context),
      'workspace_projects' => $this->workspaceProjects($context),
      default => throw new \InvalidArgumentException(sprintf('Unknown measurement context resolver "%s".', $binding['resolver'] ?? '')),
    };
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
