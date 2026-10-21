<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Session\AccountInterface;

/**
 * An account whose permissions are answered inside one tenancy chain.
 *
 * Handing this account to the entity type's own access handler lets Layer B
 * answer whatever permission the handler asks, without restating the
 * per-type operation map. Site-wide role grants pass through unchanged.
 *
 * The phpmd suppressions are forced by AccountInterface's signatures.
 *
 * @see \Drupal\bb_core\Access\BbRankEntityFence
 *
 * @SuppressWarnings("PHPMD.ShortMethodName")
 * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
 */
final class BbGroupScopedAccount implements AccountInterface {

  /**
   * The answers already given, keyed by permission.
   *
   * An access handler asks for the same permission repeatedly across the
   * operations of one request, and every miss costs an OgAccess round trip.
   *
   * @var array<string, bool>
   */
  private array $answered = [];

  /**
   * Constructs a BbGroupScopedAccount.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The real account; everything but hasPermission() is its own answer.
   * @param array<\Drupal\Core\Entity\EntityInterface> $groups
   *   The OG groups the entity belongs to, innermost first.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $capability
   *   The rank capability resolver.
   */
  public function __construct(
    private readonly AccountInterface $account,
    private readonly array $groups,
    private readonly BbRankCapabilityInterface $capability,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function hasPermission($permission): bool {
    if (isset($this->answered[$permission])) {
      return $this->answered[$permission];
    }
    // Site-wide first: it is the cheaper question and the one that must not be
    // narrowed. `administer bakers` and the machine roles arrive through here.
    if ($this->capability->hasSiteWidePermission($this->account, $permission)) {
      return $this->answered[$permission] = TRUE;
    }
    foreach ($this->groups as $group) {
      if ($this->capability->hasGroupPermission($this->account, $permission, $group)) {
        return $this->answered[$permission] = TRUE;
      }
    }

    return $this->answered[$permission] = FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function id() {
    // The real uid, deliberately: an `update own …` check has to keep meaning
    // the same person, or the fence would turn every owner into a stranger.
    return $this->account->id();
  }

  /**
   * {@inheritdoc}
   */
  public function getRoles($exclude_locked_roles = FALSE): array {
    return $this->account->getRoles($exclude_locked_roles);
  }

  /**
   * {@inheritdoc}
   */
  public function isAuthenticated(): bool {
    return $this->account->isAuthenticated();
  }

  /**
   * {@inheritdoc}
   */
  public function isAnonymous(): bool {
    return $this->account->isAnonymous();
  }

  /**
   * {@inheritdoc}
   */
  public function getPreferredLangcode($fallback_to_default = TRUE): string {
    return $this->account->getPreferredLangcode($fallback_to_default);
  }

  /**
   * {@inheritdoc}
   */
  public function getPreferredAdminLangcode($fallback_to_default = TRUE): string {
    return $this->account->getPreferredAdminLangcode($fallback_to_default);
  }

  /**
   * {@inheritdoc}
   */
  public function getAccountName(): string {
    return $this->account->getAccountName();
  }

  /**
   * {@inheritdoc}
   */
  public function getDisplayName() {
    return $this->account->getDisplayName();
  }

  /**
   * {@inheritdoc}
   */
  public function getEmail(): ?string {
    return $this->account->getEmail();
  }

  /**
   * {@inheritdoc}
   */
  public function getTimeZone() {
    return $this->account->getTimeZone();
  }

  /**
   * {@inheritdoc}
   */
  public function getLastAccessedTime(): int {
    return $this->account->getLastAccessedTime();
  }

}
