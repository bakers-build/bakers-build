<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Resolves project, host_key, and workspace for a conductor heartbeat.
 */
final class HeartbeatRegistrationResolver {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbWorkspaceReadScopeInterface $readScope,
    private readonly BbRankCapabilityInterface $rankCapability,
    private readonly WorkspaceResolverInterface $workspaceResolver,
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
   * Resolves the project the owner may register a conductor for.
   *
   * The name is looked up among the projects the owner can see, inside the
   * named workspace when one is given. The owner's own rank in the project's
   * workspace must grant `register bakers conductor`; token scopes do not
   * count. Every refusal of an existing project reads as "not found", so it
   * discloses nothing outside the owner's scope.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The conductor owner.
   */
  public function projectId(array $attrs, AccountInterface $owner): int {
    $name = isset($attrs['project']) && is_string($attrs['project']) ? $attrs['project'] : '';
    if ($name === '') {
      throw new UnprocessableEntityHttpException('project is required to register a conductor.');
    }
    $admin = $this->rankCapability->isInstanceAdmin($owner);
    $ids = $this->candidateIds($name, $attrs, $admin ? NULL : $owner);
    if ($ids === []) {
      throw $this->notFound($name);
    }
    if (count($ids) > 1) {
      throw new UnprocessableEntityHttpException(sprintf('bakers.build project "%s" is ambiguous; name its workspace.', $name));
    }
    $projectId = (int) reset($ids);
    if (!$this->mayRegister($owner, $projectId)) {
      throw $this->notFound($name);
    }
    return $projectId;
  }

  /**
   * Whether the owner can see the project and may register conductors there.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The conductor owner.
   * @param int $projectId
   *   Project entity id.
   */
  public function mayRegister(AccountInterface $owner, int $projectId): bool {
    if ($this->rankCapability->isInstanceAdmin($owner)) {
      return TRUE;
    }
    return in_array($projectId, array_map('intval', $this->readScope->projectIds($owner)), TRUE)
      && $this->rankCapability->hasGroupRolePermission($owner, 'register bakers conductor', $this->workspace($projectId));
  }

  /**
   * Returns the ids of the projects of that name the owner can see.
   *
   * @param string $name
   *   The project name.
   * @param array<string, mixed> $attrs
   *   Registration attributes; `workspace`/`workspace_id` narrow the lookup.
   * @param \Drupal\Core\Session\AccountInterface|null $owner
   *   The owner whose read scope applies, or NULL for an instance admin.
   *
   * @return array<int|string>
   *   The matching project ids.
   */
  private function candidateIds(string $name, array $attrs, ?AccountInterface $owner): array {
    $query = $this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition('name', $name);
    $workspaceId = $this->explicitWorkspaceId($attrs);
    if ($workspaceId !== NULL) {
      $query->condition('group_id.entity.workspace_id', $workspaceId);
    }
    if ($owner !== NULL) {
      $query->condition('id', $this->readScope->projectIds($owner) ?: [0], 'IN');
    }
    return $query->execute();
  }

  /**
   * Resolves the workspace a project belongs to.
   */
  private function workspace(int $projectId): BbWorkspaceInterface {
    $project = $this->entityTypeManager->getStorage('bb_project')->load($projectId);
    $workspace = $project instanceof BbProjectInterface ? $this->workspaceResolver->resolve($project) : NULL;
    if ($workspace === NULL) {
      throw new UnprocessableEntityHttpException('project has no workspace; cannot register a conductor.');
    }
    return $workspace;
  }

  /**
   * The refusal for a project outside the owner's scope or without one.
   */
  public function notFound(string $name): UnprocessableEntityHttpException {
    return new UnprocessableEntityHttpException(sprintf('bakers.build project "%s" not found.', $name));
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

}
