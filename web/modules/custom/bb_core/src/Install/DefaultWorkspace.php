<?php

declare(strict_types=1);

namespace Drupal\bb_core\Install;

use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Creates the one workspace every bakers.build instance is guaranteed to have.
 *
 * Called by bb_core_install() on every install path (recipe or
 * existing-config).
 */
final class DefaultWorkspace {

  /**
   * This class is a namespaced function, not an object.
   */
  private function __construct() {}

  /**
   * Returns the default workspace, creating it when it does not exist yet.
   *
   * Idempotent, and never touches a workspace that is already there — a
   * hand-renamed or hand-reslugged default workspace survives a re-run.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface
   *   The workspace anchored at BbWorkspace::DEFAULT_UUID.
   */
  public static function ensure(): BbWorkspaceInterface {
    $storage = \Drupal::entityTypeManager()->getStorage('bb_workspace');

    $matches = $storage->loadByProperties(['uuid' => BbWorkspace::DEFAULT_UUID]);
    $workspace = reset($matches);
    if ($workspace instanceof BbWorkspaceInterface) {
      return $workspace;
    }

    $name = (string) \Drupal::config('system.site')->get('name');
    $workspace = $storage->create([
      'uuid' => BbWorkspace::DEFAULT_UUID,
      'name' => $name !== '' ? $name : BbWorkspace::DEFAULT_NAME_FALLBACK,
      'slug' => BbWorkspace::DEFAULT_SLUG,
      'owner_user_id' => 1,
    ]);
    assert($workspace instanceof BbWorkspaceInterface);
    $workspace->save();

    return $workspace;
  }

}
