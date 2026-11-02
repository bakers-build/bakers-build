<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Core\Entity\ContentEntityInterface;

/**
 * Resolves a tool's `workspace` UUID input under view access.
 *
 * Used next to TicketInputTrait (entities()) and PagedQueryTrait (page()).
 */
trait WorkspaceInputTrait {

  /**
   * The readable workspace, or an input error naming the value.
   *
   * @throws \InvalidArgumentException
   */
  protected function readableWorkspace(string $uuid): BbWorkspaceInterface {
    $storage = $this->entities()->getStorage('bb_workspace');
    $ids = $storage->getQuery()->accessCheck(TRUE)->condition('uuid', $uuid)->range(0, 1)->execute();
    $workspace = $ids ? $storage->load(reset($ids)) : NULL;
    if (!$workspace instanceof BbWorkspaceInterface || !$workspace->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Workspace %s does not exist or is not readable.', $uuid));
    }
    return $workspace;
  }

  /**
   * One page of viewable rows of a workspace-scoped type, by name.
   *
   * @param string $type
   *   The entity type id.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param array<string, mixed> $conditions
   *   Extra equality conditions.
   * @param array<string, mixed> $values
   *   The tool inputs, for paging.
   *
   * @return array{0: array<\Drupal\Core\Entity\ContentEntityInterface>, 1: int|null}
   *   The viewable entities of the page and the next offset.
   */
  protected function workspacePage(string $type, BbWorkspaceInterface $workspace, array $conditions, array $values): array {
    $storage = $this->entities()->getStorage($type);
    $query = $storage->getQuery()->accessCheck(TRUE)
      ->condition('workspace_id', $workspace->id())
      ->sort('name')
      ->sort('id');
    foreach ($conditions as $field => $value) {
      $query->condition($field, $value);
    }
    if (($values['query'] ?? '') !== '') {
      $query->condition('name', $values['query'], 'CONTAINS');
    }
    [$ids, $next] = $this->page($query, $values);
    $entities = array_filter(
      $storage->loadMultiple($ids),
      fn ($entity) => $entity instanceof ContentEntityInterface && $entity->access('view', $this->currentUser),
    );
    return [array_values($entities), $next];
  }

}
