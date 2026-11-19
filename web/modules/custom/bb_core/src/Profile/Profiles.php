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
   * The stored profile, else an empty, unsaved one in the workspace.
   */
  public function forAccount(int $uid, int $workspace_id): BbProfileInterface {
    $storage = $this->entityTypeManager->getStorage('bb_profile');
    $found = $storage->loadByProperties(['uid' => $uid, 'workspace_id' => $workspace_id]);
    $profile = reset($found) ?: $storage->create(['uid' => $uid, 'workspace_id' => $workspace_id]);
    assert($profile instanceof BbProfileInterface);
    return $profile;
  }

  /**
   * Like ::forAccount(), but a new profile starts from the newest one.
   *
   * For paths that store the profile: position and background come from the
   * account's most recently changed profile; favorites stay per workspace.
   * Readers use ::forAccount(), so no workspace shows an unstored copy.
   */
  public function forEditing(int $uid, int $workspace_id): BbProfileInterface {
    $profile = $this->forAccount($uid, $workspace_id);
    $source = $profile->isNew() ? $this->newest($uid) : NULL;
    if ($source !== NULL) {
      $profile->setPosition($source->position())->setBackground($source->background());
    }
    return $profile;
  }

  /**
   * Stores the copied profile of a new workspace member, when there is one.
   *
   * Without an earlier profile, or with one already in the workspace,
   * nothing is stored.
   */
  public function provideFor(int $uid, int $workspace_id): void {
    $profile = $this->forEditing($uid, $workspace_id);
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
