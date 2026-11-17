<?php

declare(strict_types=1);

namespace Drupal\bb_core\Profile;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProfileInterface;

/**
 * Finds an account's profile in a workspace, or prepares a new one.
 */
final class Profiles {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * The stored profile, else an unsaved one for the account and workspace.
   */
  public function forAccount(int $uid, int $workspace_id): BbProfileInterface {
    $storage = $this->entityTypeManager->getStorage('bb_profile');
    $found = $storage->loadByProperties(['uid' => $uid, 'workspace_id' => $workspace_id]);
    $profile = reset($found) ?: $storage->create(['uid' => $uid, 'workspace_id' => $workspace_id]);
    assert($profile instanceof BbProfileInterface);
    return $profile;
  }

  /**
   * Every stored profile of an account, keyed by workspace id.
   *
   * @return array<int, \Drupal\bb_core\Entity\BbProfileInterface>
   *   The profiles.
   */
  public function ofAccount(int $uid): array {
    $profiles = [];
    foreach ($this->entityTypeManager->getStorage('bb_profile')->loadByProperties(['uid' => $uid]) as $profile) {
      assert($profile instanceof BbProfileInterface);
      $profiles[$profile->workspaceId()] = $profile;
    }
    ksort($profiles);
    return $profiles;
  }

}
