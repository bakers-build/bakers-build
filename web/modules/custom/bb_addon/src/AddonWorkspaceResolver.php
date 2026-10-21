<?php

declare(strict_types=1);

namespace Drupal\bb_addon;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Derives a conductor's workspace from its project → group → workspace.
 *
 * BB-660/661: registration identity is workspace-scoped, and the workspace
 * is never caller-selected — it is always this derivation, so a conductor
 * cannot register into a workspace it does not actually belong to.
 */
final class AddonWorkspaceResolver {

  /**
   * The conductor's workspace, or NULL when its ancestry does not resolve.
   */
  public function resolve(BbConductorInterface $conductor): ?BbWorkspaceInterface {
    $project = $conductor->get('project_id')->entity;
    if (!$project instanceof BbProjectInterface) {
      return NULL;
    }
    $group = $project->getGroup();
    return $group?->getWorkspace();
  }

}
