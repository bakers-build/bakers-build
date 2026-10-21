<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Resolves the workspace a bakers.build content entity belongs to.
 *
 * The workspace segment of every product URL is the workspace slug, and no
 * workspace-owned entity carries a direct workspace reference. This is the
 * single place that knows how to get from a row to its workspace, so URL
 * generation and the workspace access check can never disagree about it.
 */
interface WorkspaceResolverInterface {

  /**
   * Resolves the workspace an entity belongs to.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity whose workspace to resolve.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface|null
   *   The workspace, or NULL when the entity type declares no chain or any hop
   *   of its chain is empty.
   */
  public function resolve(EntityInterface $entity): ?BbWorkspaceInterface;

  /**
   * Whether an entity type is workspace-owned, i.e. declares a chain.
   *
   * Asked separately from resolve() because the two NULLs mean different
   * things: a type with no chain is not workspace-owned at all
   * (bb_workspace), while a type WITH a chain that resolves to NULL is a row
   * that belongs to no workspace and must therefore not be reachable under any
   * workspace prefix.
   *
   * @param string $entity_type_id
   *   The entity type id to test.
   *
   * @return bool
   *   TRUE when a chain is declared for the type.
   */
  public function hasChain(string $entity_type_id): bool;

}
