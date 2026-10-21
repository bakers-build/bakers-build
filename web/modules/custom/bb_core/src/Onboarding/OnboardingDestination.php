<?php

declare(strict_types=1);

namespace Drupal\bb_core\Onboarding;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\user\UserStorageInterface;

/**
 * Whether onboarding still must run for an account, and where it lives.
 *
 * `isComplete()` READS `field_onboarding_completed`, never optional profile
 * fullness or workspace membership: false or unset means the wizard is still
 * required; only a successful final wizard POST — Finish, Finish & create,
 * or Set up later — writes true. A site without the field at all treats
 * every account as complete.
 */
final class OnboardingDestination {

  /**
   * The four-step HTMX wizard.
   */
  public const WIZARD_ROUTE = 'bb_core.onboarding';

  /**
   * The stored completion field on `user`.
   */
  public const COMPLETION_FIELD = 'field_onboarding_completed';

  /**
   * The user storage, loaded lazily from the injected entity type manager.
   */
  private UserStorageInterface $userStorage;

  /**
   * Constructs the destination rule.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Resolves the user storage, which loads the full user entity a bare
   *   `AccountInterface` may not carry the onboarding fields on.
   */
  public function __construct(EntityTypeManagerInterface $entityTypeManager) {
    $storage = $entityTypeManager->getStorage('user');
    assert($storage instanceof UserStorageInterface);
    $this->userStorage = $storage;
  }

  /**
   * Whether the account has finished the onboarding wizard.
   *
   * FALSE when the user cannot be loaded, or the field is empty or stored as
   * false. Optional profile answers never substitute for this. TRUE when the
   * site has no completion field at all — between a code deploy and the
   * config import nothing could ever mark an account complete, so treating
   * it as incomplete would loop every account through the wizard.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to inspect.
   *
   * @return bool
   *   TRUE when `field_onboarding_completed` is stored as true or does not
   *   exist on this site.
   */
  public function isComplete(AccountInterface $account): bool {
    $user = $this->userStorage->load($account->id());
    if ($user === NULL) {
      return FALSE;
    }
    if (!$user->hasField(self::COMPLETION_FIELD)) {
      return TRUE;
    }
    return (bool) $user->get(self::COMPLETION_FIELD)->value;
  }

  /**
   * The wizard URL every incomplete interactive entry must reach.
   *
   * @return \Drupal\Core\Url
   *   The onboarding wizard route.
   */
  public function wizardUrl(): Url {
    return Url::fromRoute(self::WIZARD_ROUTE);
  }

  /**
   * Records successful final wizard completion.
   *
   * Only this write, from a CSRF-protected POST, sets the flag. GET, Skip,
   * Next, Back and field fullness never call it. A late POST never clears a
   * flag that is already true.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account that finished the wizard.
   */
  public function markComplete(AccountInterface $account): void {
    $user = $this->userStorage->load($account->id());
    if ($user === NULL || !$user->hasField(self::COMPLETION_FIELD)) {
      return;
    }
    $user->set(self::COMPLETION_FIELD, TRUE);
    $user->save();
  }

}
