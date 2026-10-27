<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Figure;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\og\MembershipManagerInterface;

/**
 * Decides whether a filter entity lies in a workspace, project or user scope.
 *
 * Filter values arrive from the request, so this is the trust boundary that
 * keeps a selection from reaching into another workspace, another project or
 * another account's projects.
 */
final class WorkspaceFilterScope {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ?MembershipManagerInterface $membershipManager,
  ) {}

  /**
   * Whether a filter entity belongs to the scope.
   *
   * In a workspace: its projects, teams and users. A user belongs as a member,
   * or as the assignee of a ticket in one of the workspace's projects: figures
   * attribute to the current assignee, who may have left the workspace since.
   * In a project: its epics, and the assignees of its tickets. A user scope
   * holds only the projects of tickets assigned to that user.
   */
  public function contains(EntityInterface $scope, EntityInterface $entity): bool {
    if ($scope->getEntityTypeId() === 'bb_project') {
      return match ($entity->getEntityTypeId()) {
        'bb_ticket' => $this->isEpicOf($scope, $entity),
        'user' => $this->matches('bb_ticket', 'assignee_user_id', $entity->id(), 'project_id', $scope),
        default => FALSE,
      };
    }
    if ($scope->getEntityTypeId() === 'user') {
      return $entity->getEntityTypeId() === 'bb_project'
        && $this->matches('bb_ticket', 'project_id', $entity->id(), 'assignee_user_id', $scope);
    }
    return match ($entity->getEntityTypeId()) {
      'bb_project' => $this->matches('bb_project', 'id', $entity->id(), 'group_id.entity.workspace_id', $scope),
      'bb_team' => $this->matches('bb_team', 'id', $entity->id(), 'workspace_id', $scope),
      'user' => $this->membershipManager?->getMembership($scope, (int) $entity->id()) !== NULL
        || $this->matches('bb_ticket', 'assignee_user_id', $entity->id(), 'project_id.entity.group_id.entity.workspace_id', $scope),
      default => FALSE,
    };
  }

  /**
   * Whether a ticket is an epic of the project.
   */
  private function isEpicOf(EntityInterface $project, EntityInterface $ticket): bool {
    return (int) $this->entityTypeManager->getStorage('bb_ticket')->getQuery()
      ->accessCheck(FALSE)
      ->condition('id', $ticket->id())
      ->condition('ticket_type.entity:bb_term.name', 'epic')
      ->condition('project_id', $project->id())
      ->range(0, 1)
      ->count()
      ->execute() > 0;
  }

  /**
   * Whether an entity matching one field lies in the scope.
   */
  private function matches(string $entityTypeId, string $field, int|string|null $value, string $scopeField, EntityInterface $scope): bool {
    return (int) $this->entityTypeManager->getStorage($entityTypeId)->getQuery()
      ->accessCheck(FALSE)
      ->condition($field, $value)
      ->condition($scopeField, $scope->id())
      ->range(0, 1)
      ->count()
      ->execute() > 0;
  }

}
