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
   *
   * An unsaved profile starts with the position and background of the
   * account's most recently changed profile; favorites stay per workspace.
   */
  public function forAccount(int $uid, int $workspace_id): BbProfileInterface {
    $storage = $this->entityTypeManager->getStorage('bb_profile');
    $found = $storage->loadByProperties(['uid' => $uid, 'workspace_id' => $workspace_id]);
    $profile = reset($found);
    if (!$profile) {
      $source = $this->newest($uid);
      $profile = $storage->create([
        'uid' => $uid,
        'workspace_id' => $workspace_id,
        'position' => $source?->position() ?? '',
        'background' => $source?->background() ?? '',
      ]);
    }
    assert($profile instanceof BbProfileInterface);
    return $profile;
  }

  /**
   * Stores the copied profile of a new workspace member, when there is one.
   *
   * Without an earlier profile, or with one already in the workspace,
   * nothing is stored.
   */
  public function provideFor(int $uid, int $workspace_id): void {
    $profile = $this->forAccount($uid, $workspace_id);
    if ($profile->isNew() && ($profile->position() !== '' || $profile->background() !== '')) {
      $profile->save();
    }
  }

  /**
   * The account's most recently changed profile, if any.
   */
  private function newest(int $uid): ?BbProfileInterface {
    $storage = $this->entityTypeManager->getStorage('bb_profile');
    $ids = $storage->getQuery()->accessCheck(FALSE)->condition('uid', $uid)
      ->sort('changed', 'DESC')->sort('id', 'DESC')->range(0, 1)->execute();
    $profile = $ids ? $storage->load(reset($ids)) : NULL;
    return $profile instanceof BbProfileInterface ? $profile : NULL;
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
