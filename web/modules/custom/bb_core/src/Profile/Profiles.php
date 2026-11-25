<?php

declare(strict_types=1);

namespace Drupal\bb_core\Profile;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\user\UserDataInterface;

/**
 * Finds an account's profile in a workspace, or prepares a new one.
 */
final class Profiles {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly UserDataInterface $userData,
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
   * account's most recently changed profile, else from its default profile;
   * favorites stay per workspace. Readers use ::forAccount(), so no
   * workspace shows an unstored copy.
   */
  public function forEditing(int $uid, int $workspace_id): BbProfileInterface {
    $profile = $this->forAccount($uid, $workspace_id);
    if (!$profile->isNew()) {
      return $profile;
    }
    $source = $this->newest($uid);
    $default = $source === NULL ? $this->defaultProfile($uid) : NULL;
    $profile->setPosition($source?->position() ?? $default['position'] ?? '')
      ->setBackground($source?->background() ?? $default['background'] ?? '');
    return $profile;
  }

  /**
   * The account's default profile, kept from onboarding before any workspace.
   *
   * @return array{position: string, background: string}
   *   Position and background; empty strings when none is kept.
   */
  public function defaultProfile(int $uid): array {
    $data = $this->userData->get('bb_core', $uid, 'default_profile');
    return [
      'position' => is_array($data) && is_string($data['position'] ?? NULL) ? $data['position'] : '',
      'background' => is_array($data) && is_string($data['background'] ?? NULL) ? $data['background'] : '',
    ];
  }

  /**
   * Keeps the account's default profile for profiles prepared later.
   */
  public function setDefaultProfile(int $uid, string $position, string $background): void {
    $this->userData->set('bb_core', $uid, 'default_profile', ['position' => $position, 'background' => $background]);
  }

  /**
   * Stores the copied profile of a new workspace member, when there is one.
   *
   * Without an earlier or default profile, or with one already in the
   * workspace, nothing is stored.
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
