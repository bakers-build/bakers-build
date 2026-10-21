<?php

declare(strict_types=1);

namespace Drupal\bb_track\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_track\WorkAssignments;

/**
 * Every new project gets one active, editable Internal billing profile.
 */
final class ProjectBillingProfileHooks {

  /**
   * Constructs the lifecycle hook.
   */
  public function __construct(private WorkAssignments $assignments) {}

  /**
   * Implements hook_ENTITY_TYPE_insert() for bb_project.
   *
   * Runs for every non-import creation path, UI and non-UI (JSON:API, CLI):
   * entity storage save() wraps presave/insert/postSave in one database
   * transaction, so a failure here rolls the project creation back with it.
   * Insert-only: ordinary project saves never reach this hook again.
   *
   * ponytail: the account save takes the global, non-waiting assignments
   * lock, so a project created while another account write holds it fails
   * and rolls back ("Refresh and retry"); give the lock a short wait if
   * concurrent project creation becomes common.
   */
  #[Hook('bb_project_insert')]
  public function createDefault(EntityInterface $project): void {
    assert($project instanceof BbProjectInterface);
    if ($project->isSyncing()) {
      // Recipe/config import supplies its own explicit account fixtures;
      // creating one here would collide with them under the uniqueness guard.
      return;
    }
    $this->assignments->createDefaultAccount($project);
  }

}
