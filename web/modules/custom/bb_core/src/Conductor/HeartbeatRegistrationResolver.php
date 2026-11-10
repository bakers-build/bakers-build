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
   * Resolves conductor_id; a payload without one comes from a stale CLI.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  public function conductorId(array $attrs): string {
    if (isset($attrs['conductor_id']) && is_string($attrs['conductor_id']) && $attrs['conductor_id'] !== '') {
      return $attrs['conductor_id'];
    }
    throw new UnprocessableEntityHttpException('conductor_id is required; update bakers and run bakers init.');
  }

  /**
   * Resolves host_key, the machine_id of machine.config.js.
   *
   * New machines get a UUID from bakers init; existing ones keep their id.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   */
  public function hostKey(array $attrs): string {
    if (isset($attrs['host_key']) && is_string($attrs['host_key']) && $attrs['host_key'] !== '') {
      return $attrs['host_key'];
    }
    throw new UnprocessableEntityHttpException('host_key is required; update bakers and run bakers init.');
  }

  /**
   * Validates the credential report and returns it as JSON.
   *
   * Each entry keeps name, status, reason and expires_at (when given); other
   * keys are dropped. Registration pings from `poll`/`reap` send no report.
   *
   * @param array<string, mixed> $attrs
   *   Registration attributes.
   *
   * @return string|null
   *   The JSON list to store, or NULL when the attribute is absent.
   */
  public function credentialHealth(array $attrs): ?string {
    if (!array_key_exists('credentials', $attrs)) {
      return NULL;
    }
    $report = $attrs['credentials'];
    if (!is_array($report) || !array_is_list($report) || count($report) > 50) {
      throw new UnprocessableEntityHttpException('credentials must be a list of at most 50 entries.');
    }
    return json_encode(
      array_map($this->credentialEntry(...), $report, array_keys($report)),
      JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
    );
  }

  /**
   * Validates one credential report entry and keeps its known keys.
   *
   * @param mixed $entry
   *   The reported entry.
   * @param int $index
   *   Its position, for the error message.
   *
   * @return array<string, string>
   *   name, status, expires_at (when given) and reason.
   */
  private function credentialEntry(mixed $entry, int $index): array {
    $name = $entry['name'] ?? NULL;
    $status = $entry['status'] ?? NULL;
    $reason = $entry['reason'] ?? NULL;
    $expires = $entry['expires_at'] ?? NULL;
    $valid = is_string($name) && mb_strlen($name) <= 200
      && is_string($reason) && mb_strlen($reason) <= 200
      && in_array($status, ['ok', 'warning', 'error'], TRUE)
      && ($expires === NULL || $this->isIsoDate($expires));
    if (!$valid) {
      throw new UnprocessableEntityHttpException(sprintf('credentials[%d] needs name and reason (at most 200 characters), status ok, warning or error, and expires_at as YYYY-MM-DD when given.', $index));
    }
    return ['name' => $name, 'status' => $status]
      + ($expires !== NULL ? ['expires_at' => $expires] : [])
      + ['reason' => $reason];
  }

  /**
   * Whether a value is a real calendar date written as YYYY-MM-DD.
   */
  private function isIsoDate(mixed $value): bool {
    if (!is_string($value) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) !== 1) {
      return FALSE;
    }
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
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
