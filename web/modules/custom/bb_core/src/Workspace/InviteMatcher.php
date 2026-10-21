<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workspace;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\user\UserInterface;

/**
 * Finds the invitations addressed to an account's own e-mail address.
 *
 * Memoised per request and never invalidated: both provisioning paths end in
 * a redirect, so a consumed invitation is re-read on the next request.
 *
 * Matches only the loaded account's own address. The query is NOT
 * access-checked, because query access narrows `bb_invite` to workspaces the
 * invitee is not yet in; the address equality is the authorisation, re-checked
 * by the join route's access and its submit handler.
 */
final class InviteMatcher {

  /**
   * Matched invitations, keyed by uid, for the life of the request.
   *
   * @var array<int, array<\Drupal\bb_core\Entity\BbInvite>>
   */
  private array $matched = [];

  /**
   * Constructs the matcher.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Loads the account and queries invitations.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * The invitations addressed to this account's e-mail address.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The signed-in account.
   *
   * @return array<\Drupal\bb_core\Entity\BbInvite>
   *   The matching invitations, ordered by id ascending.
   */
  public function forAccount(AccountInterface $account): array {
    $uid = (int) $account->id();
    if (isset($this->matched[$uid])) {
      return $this->matched[$uid];
    }
    $this->matched[$uid] = $this->query($account);
    return $this->matched[$uid];
  }

  /**
   * Invitation offers for this account, minus workspaces it already holds.
   *
   * An invitation to a workspace the person is already in is a leftover row,
   * not an offer; its join would only be refused. A missing workspace is
   * likewise not an offer.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The signed-in account.
   * @param array<int|string> $heldWorkspaceIds
   *   Workspace ids the account already belongs to.
   *
   * @return array<\Drupal\bb_core\Entity\BbInvite>
   *   Offers to existing workspaces outside the held set.
   */
  public function offersForAccount(AccountInterface $account, array $heldWorkspaceIds): array {
    $held = [];
    foreach ($heldWorkspaceIds as $id) {
      $held[(string) $id] = TRUE;
    }
    $offers = [];
    foreach ($this->forAccount($account) as $invite) {
      $workspace = $invite->getWorkspace();
      if ($workspace === NULL || isset($held[(string) $workspace->id()])) {
        continue;
      }
      $offers[] = $invite;
    }
    return $offers;
  }

  /**
   * Whether one invitation is addressed to this account.
   *
   * The join route's access check and its submit handler both ask this, so
   * neither has to re-derive the rule from the address.
   *
   * @param \Drupal\bb_core\Entity\BbInvite $invite
   *   The invitation.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   *
   * @return bool
   *   TRUE when the invitation is for that account's address.
   */
  public function matches(BbInvite $invite, AccountInterface $account): bool {
    $mail = $this->mailOf($account);
    return $mail !== '' && $invite->isFor($mail);
  }

  /**
   * Runs the query behind ::forAccount().
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The signed-in account.
   *
   * @return array<\Drupal\bb_core\Entity\BbInvite>
   *   The matching invitations.
   */
  private function query(AccountInterface $account): array {
    $mail = $this->mailOf($account);
    if ($mail === '') {
      return [];
    }
    $storage = $this->entityTypeManager->getStorage('bb_invite');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      // The stored value keeps whatever case it was written in, so the
      // comparison is made case-insensitive here rather than trusting the
      // column's collation — this one has to be right on every back end,
      // because a missed match is a customer sent to the no-workspace state
      // while the workspace they belong to sits one row away.
      ->condition('email', $mail, 'LIKE')
      ->sort('id')
      ->execute();
    $invites = [];
    foreach ($storage->loadMultiple($ids) as $invite) {
      // RE-CHECKED IN PHP, not left to `LIKE`. `LIKE` is case-insensitive on
      // both supported back ends AND treats `%` and `_` in the needle as
      // wildcards — an address containing one would otherwise match rows it
      // was never for. The equality below is the actual rule.
      if ($invite instanceof BbInvite && $invite->isFor($mail)) {
        $invites[] = $invite;
      }
    }
    return $invites;
  }

  /**
   * The account's e-mail address, loaded from the account entity.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   *
   * @return string
   *   The address, or an empty string when the account has none.
   */
  private function mailOf(AccountInterface $account): string {
    if ($account->isAnonymous()) {
      return '';
    }
    $loaded = $this->entityTypeManager->getStorage('user')->load($account->id());
    return $loaded instanceof UserInterface ? trim((string) $loaded->getEmail()) : '';
  }

}
