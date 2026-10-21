<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_core\Entity\BbProjectInterface;

/**
 * Title callback every project tab shares.
 *
 * Overview is core's `_entity_view` of `bb_project.full`. Board is the
 * Views page `view.project_board.project_board`.
 *.
 */
final class BbProjectTabController extends ControllerBase {

  /**
   * The project's own label, for every tab route.
   */
  public function title(BbProjectInterface $bb_project): string {
    return (string) $bb_project->label();
  }

}
