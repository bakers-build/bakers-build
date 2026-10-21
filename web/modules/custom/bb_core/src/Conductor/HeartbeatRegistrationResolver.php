<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Resolves project, host_key, and workspace for a conductor heartbeat.
 */
final class HeartbeatRegistrationResolver {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * Resolves conductor_id, accepting legacy machine_id as alias.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  public function conductorId(array $attrs): string {
    if (isset($attrs['conductor_id']) && is_string($attrs['conductor_id']) && $attrs['conductor_id'] !== '') {
      return $attrs['conductor_id'];
    }
    if (isset($attrs['machine_id']) && is_string($attrs['machine_id']) && $attrs['machine_id'] !== '') {
      return $attrs['machine_id'];
    }
    throw new UnprocessableEntityHttpException('conductor_id is required.');
  }

  /**
   * Resolves host_key from attrs or derives a stem from conductor_id.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   * @param string $conductorId
   *   Resolved conductor registration key.
   */
  public function hostKey(array $attrs, string $conductorId): string {
    if (isset($attrs['host_key']) && is_string($attrs['host_key']) && $attrs['host_key'] !== '') {
      return $attrs['host_key'];
    }
    $parts = explode('-', $conductorId);
    if (count($parts) >= 3 && $parts[0] !== '' && $parts[1] !== '') {
      return implode('-', array_slice($parts, 1, -1)) ?: $conductorId;
    }
    return $conductorId;
  }

  /**
   * Resolves the project entity id from the heartbeat's `project` name.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  public function projectId(array $attrs): int {
    $name = isset($attrs['project']) && is_string($attrs['project']) ? $attrs['project'] : '';
    if ($name === '') {
      throw new UnprocessableEntityHttpException('project is required to register a conductor.');
    }
    $ids = $this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition('name', $name)
      ->range(0, 1)
      ->execute();
    if ($ids === []) {
      throw new UnprocessableEntityHttpException(sprintf('bakers.build project "%s" not found.', $name));
    }
    return (int) reset($ids);
  }

  /**
   * Resolves the workspace id from explicit attrs or project chain.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   * @param int $projectId
   *   Resolved project entity id.
   */
  public function workspaceId(array $attrs, int $projectId): int {
    $explicit = $this->explicitWorkspaceId($attrs);
    if ($explicit !== NULL) {
      return $explicit;
    }
    return $this->workspaceIdFromProject($projectId);
  }

  /**
   * Resolves workspace from explicit workspace_id or workspace token.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   *
   * @return int|null
   *   Workspace id when an explicit token is present.
   */
  private function explicitWorkspaceId(array $attrs): ?int {
    if (isset($attrs['workspace_id']) && is_numeric($attrs['workspace_id'])) {
      $id = (int) $attrs['workspace_id'];
      if ($this->entityTypeManager->getStorage('bb_workspace')->load($id) instanceof BbWorkspaceInterface) {
        return $id;
      }
      throw new UnprocessableEntityHttpException(sprintf('bakers.build workspace id %d not found.', $id));
    }
    if (!isset($attrs['workspace']) || !is_string($attrs['workspace']) || $attrs['workspace'] === '') {
      return NULL;
    }
    $token = $attrs['workspace'];
    $storage = $this->entityTypeManager->getStorage('bb_workspace');
    foreach (['uuid' => $token, 'name' => $token] as $field => $value) {
      $matches = $storage->loadByProperties([$field => $value]);
      $workspace = reset($matches);
      if ($workspace instanceof BbWorkspaceInterface) {
        return (int) $workspace->id();
      }
    }
    throw new UnprocessableEntityHttpException(sprintf('bakers.build workspace "%s" not found.', $token));
  }

  /**
   * Resolves workspace via project → group → workspace_id.
   */
  private function workspaceIdFromProject(int $projectId): int {
    $project = $this->entityTypeManager->getStorage('bb_project')->load($projectId);
    if (!$project instanceof BbProjectInterface) {
      throw new UnprocessableEntityHttpException('bakers.build project not found for workspace resolution.');
    }
    $group = $project->getGroup();
    if (!$group instanceof BbGroupInterface) {
      throw new UnprocessableEntityHttpException('project has no group; cannot resolve workspace for conductor.');
    }
    $workspaceId = $group->get('workspace_id')->target_id;
    if ($workspaceId === NULL || $workspaceId === '') {
      throw new UnprocessableEntityHttpException('group has no workspace_id; cannot resolve workspace for conductor.');
    }
    return (int) $workspaceId;
  }

}
