<?php

declare(strict_types=1);

namespace Drupal\bb_core\RunLog;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Site\Settings;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Decides whether a run's agent transcript may be stored.
 *
 * Effective storage needs both the operator flag
 * `$settings['feature_flags']['run_log_storage']` (set from the
 * FEATURE_FLAG_RUN_LOG_STORAGE environment variable, pinned off in SaaS) and
 * the opt-in of the run's own workspace. Anything else, including a run with
 * no resolvable workspace, is denied. Operational `error_log` is not gated.
 */
final class RunLogPolicy {

  public const FLAG = 'run_log_storage';

  public const WORKSPACE_FIELD = 'run_log_storage_enabled';

  public const RUN_FIELD = 'run_log_storage_allowed';

  public function __construct(
    private readonly WorkspaceResolverInterface $workspaceResolver,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * Whether the deployment offers run-log storage at all.
   */
  public static function isAvailable(): bool {
    return (Settings::get('feature_flags', [])[self::FLAG] ?? FALSE) === TRUE;
  }

  /**
   * Whether a transcript of this run may be stored right now.
   */
  public function allowsStorage(EntityInterface $run): bool {
    if (!self::isAvailable()) {
      return FALSE;
    }
    $workspace = $this->workspaceResolver->resolve($run);
    if ($workspace === NULL) {
      return FALSE;
    }
    // The persisted row, so a copy loaded before a disable cannot allow.
    $current = $this->entityTypeManager->getStorage('bb_workspace')->loadUnchanged($workspace->id());
    return $current instanceof BbWorkspaceInterface
      && (bool) $current->get(self::WORKSPACE_FIELD)->value;
  }

}
