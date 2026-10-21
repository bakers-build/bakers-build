<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Resolves an entity's workspace by walking a declared reference chain.
 *
 * IMPORTANT — this is entity-API traversal, NOT a query-access condition. The
 * single-level rule in CLAUDE.md ("Query access — two traps that return
 * plausible results instead of errors") exists because
 * ViewsQueryAlter::mapConditions() explodes a condition field on the first `.`
 * and silently applies a traversing condition to the wrong column. That rule
 * governs strings handed to a query condition. Nothing here builds a
 * condition: every hop is an EntityReferenceFieldItemList::$entity load, which
 * the entity API performs correctly at any depth. A reviewer must not
 * "fix" this into a single-level lookup.
 *
 * @see \Drupal\bb_core\Access\BbWorkspaceReadScope::projectsOfWorkspaces()
 */
final class WorkspaceResolver implements WorkspaceResolverInterface {

  /**
   * The reference chain from each workspace-owned type to its workspace.
   *
   * The types whose product routes carry a workspace segment. bb_workspace
   * is absent because a workspace cannot be addressed inside itself.
   *
   * @var array<string, array<string>>
   */
  private const CHAINS = [
    'bb_group' => ['workspace_id'],
    'bb_team' => ['workspace_id'],
    'bb_project' => ['group_id', 'workspace_id'],
    'bb_ticket' => ['project_id', 'group_id', 'workspace_id'],
    'bb_ticket_template' => ['project_id', 'group_id', 'workspace_id'],
    'bb_ticket_trigger' => ['workspace_id'],
    'bb_environment' => ['project_id', 'group_id', 'workspace_id'],
    'bb_conductor' => ['project_id', 'group_id', 'workspace_id'],
    'bb_run' => ['ticket_id', 'project_id', 'group_id', 'workspace_id'],
    'bb_comment' => ['ticket_id', 'project_id', 'group_id', 'workspace_id'],
  ];

  /**
   * The chain walked when the primary chain ends on an empty hop.
   *
   * A ticket template belongs to exactly one project or one workspace.
   *
   * @var array<string, array<string>>
   */
  public const ALTERNATE_CHAINS = [
    'bb_ticket_template' => ['workspace_id'],
  ];

  /**
   * Resolved workspaces keyed by "<entity type>:<id>".
   *
   * Request-scoped and never invalidated, like BbWorkspaceReadScope: a
   * rendered page asks the same handful of chains repeatedly (every ticket in
   * a list walks four hops to the same workspace), and a chain rewritten
   * mid-request is not a case any surface produces.
   *
   * @var array<string, \Drupal\bb_core\Entity\BbWorkspaceInterface|null>
   */
  private array $resolved = [];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * The chain of a type: listed here, or declared as `bb_workspace_path`.
   *
   * A module that owns a type outside bb_core declares the path on its
   * entity type instead of being named here.
   *
   * @return array<string>|null
   *   The reference field names to follow, or NULL.
   */
  private function chain(string $entity_type_id): ?array {
    if (isset(self::CHAINS[$entity_type_id])) {
      return self::CHAINS[$entity_type_id];
    }
    $path = $this->entityTypeManager->getDefinition($entity_type_id, FALSE)?->get('bb_workspace_path');
    return is_array($path) && $path !== [] ? array_values(array_map('strval', $path)) : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function hasChain(string $entity_type_id): bool {
    return $this->chain($entity_type_id) !== NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function resolve(EntityInterface $entity): ?BbWorkspaceInterface {
    $chain = $this->chain($entity->getEntityTypeId());
    if ($chain === NULL) {
      return NULL;
    }
    // An unsaved entity has no stable key, so it is resolved but not cached.
    $id = $entity->id();
    $key = $id === NULL ? NULL : $entity->getEntityTypeId() . ':' . $id;
    if ($key !== NULL && array_key_exists($key, $this->resolved)) {
      return $this->resolved[$key];
    }

    $workspace = $this->walk($entity, $chain);
    if ($workspace === NULL && isset(self::ALTERNATE_CHAINS[$entity->getEntityTypeId()])) {
      $workspace = $this->walk($entity, self::ALTERNATE_CHAINS[$entity->getEntityTypeId()]);
    }
    if ($key !== NULL) {
      $this->resolved[$key] = $workspace;
    }
    return $workspace;
  }

  /**
   * Walks one chain hop by hop.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity the chain starts at.
   * @param array<string> $chain
   *   The reference field names to follow, in order.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface|null
   *   The workspace at the end of the chain, or NULL on any empty hop.
   */
  private function walk(EntityInterface $entity, array $chain): ?BbWorkspaceInterface {
    $current = $entity;
    foreach ($chain as $field_name) {
      if (!$current instanceof FieldableEntityInterface || !$current->hasField($field_name)) {
        return NULL;
      }
      $next = $current->get($field_name)->entity;
      if (!$next instanceof EntityInterface) {
        return NULL;
      }
      $current = $next;
    }
    return $current instanceof BbWorkspaceInterface ? $current : NULL;
  }

}
