<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the branch a ticket's work is based on.
 *
 * Resolution order: the direct parent's branch_name (a single hop, so
 * multilevel hierarchies use the direct parent); else the project's
 * repository's non-empty default_branch; else 'main'. Always non-empty.
 * Read-only: parent_id and project.repository remain the source of truth.
 */
final class BaseBranchItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface) {
      return;
    }
    $this->list[0] = $this->createItem(0, ['value' => $this->resolve($ticket)]);
  }

  /**
   * Resolves the base branch for a ticket.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket whose base branch is computed.
   *
   * @return string
   *   The direct parent's branch_name, else the repository's default_branch,
   *   else 'main'.
   */
  private function resolve(BbTicketInterface $ticket): string {
    // 1. Direct parent's branch.
    if (!$ticket->get('parent_id')->isEmpty()) {
      $parent = $ticket->get('parent_id')->entity;
      if ($parent instanceof BbTicketInterface) {
        $branch = (string) $parent->get('branch_name')->value;
        if ($branch !== '') {
          return $branch;
        }
      }
    }
    // 2. The project's repository default_branch.
    if (!$ticket->get('project_id')->isEmpty()) {
      $project = $ticket->get('project_id')->entity;
      if ($project instanceof ContentEntityInterface) {
        $repo = $project->get('repository')->first();
        $default = $repo === NULL ? '' : (string) $repo->get('default_branch')->getValue();
        if ($default !== '') {
          return $default;
        }
      }
    }
    // 3. Fallback.
    return 'main';
  }

}
