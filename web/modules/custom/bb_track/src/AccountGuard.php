<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_track\Entity\Account;

/**
 * Content invariants for a billing account, checked before any write.
 *
 * Split out of WorkAssignments so its ticket-ancestry and uniqueness checks
 * do not inflate the class that resolves and presents accounts.
 */
final class AccountGuard {

  /**
   * Constructs the application service.
   */
  public function __construct(
    private EntityTypeManagerInterface $entities,
    private WorkAssignments $assignments,
  ) {}

  /**
   * Validates an account's content before any write, whoever writes it.
   *
   * Called by the storage under the assignments lock, so the uniqueness
   * checks never run unlocked.
   */
  public function validate(Account $billing_account): void {
    $project_id = (int) $billing_account->get('project_id')->target_id;
    $this->requireProject($project_id);
    $original = $this->original($billing_account);
    $tickets = WorkAssignments::linkedTickets($billing_account);
    $this->checkTickets($original, $project_id, $tickets);
    AccountValidation::values([
      'name' => (string) $billing_account->label(),
      'external_id' => (string) ($billing_account->get('external_id')->value ?? ''),
    ]);
    $terms = AccountValidation::terms(AccountValidation::termsOf($billing_account));
    if ($terms !== []) {
      throw new \InvalidArgumentException(reset($terms));
    }
    $default = (bool) $billing_account->get('is_default')->value;
    if ($default && $tickets !== []) {
      throw new \DomainException('The project default cannot be linked to tickets.');
    }
    if (!$billing_account->get('active')->value) {
      if ($default && $original instanceof Account && $original->get('active')->value) {
        throw new \DomainException('Make another billing account the default before archiving this one.');
      }
      return;
    }
    $this->uniqueActive($project_id, $billing_account->isNew() ? NULL : (int) $billing_account->id(), $default, $tickets);
  }

  /**
   * Rejects an account with no existing project.
   */
  private function requireProject(int $project_id): void {
    if (!$project_id || !$this->entities->getStorage('bb_project')->load($project_id) instanceof BbProjectInterface) {
      throw new \DomainException('Billing account needs an existing project.');
    }
  }

  /**
   * The account's stored state, or NULL for one not yet saved.
   */
  private function original(Account $billing_account): ?Account {
    if ($billing_account->isNew()) {
      return NULL;
    }
    $original = $this->entities->getStorage('bb_track_account')->loadUnchanged($billing_account->id());
    return $original instanceof Account ? $original : NULL;
  }

  /**
   * Rejects a duplicate link, then re-checks ancestry of newly added tickets.
   *
   * An unchanged link skips re-validation even after its ticket is gone.
   *
   * @param \Drupal\bb_track\Entity\Account|null $original
   *   The account's stored state, or NULL for one not yet saved.
   * @param int $project_id
   *   The project.
   * @param list<int> $tickets
   *   The tickets the account links.
   */
  private function checkTickets(?Account $original, int $project_id, array $tickets): void {
    $stored_project_id = $original instanceof Account ? (int) $original->get('project_id')->target_id : NULL;
    $stored_tickets = $original instanceof Account && $stored_project_id === $project_id ? WorkAssignments::linkedTickets($original) : [];
    if (count($tickets) !== count(array_unique($tickets))) {
      throw new \DomainException('A ticket is linked to this billing account twice.');
    }
    foreach (array_diff($tickets, $stored_tickets) as $ticket_id) {
      $this->assignments->ancestry($project_id, $ticket_id);
    }
  }

  /**
   * Rejects a second active default, or a ticket another account links.
   *
   * @param int $project_id
   *   The project.
   * @param int|null $exclude_id
   *   The account being saved, or NULL when new.
   * @param bool $default
   *   Whether the account being saved is the default.
   * @param list<int> $tickets
   *   The tickets it links.
   */
  private function uniqueActive(int $project_id, ?int $exclude_id, bool $default, array $tickets): void {
    foreach ($this->assignments->activeAccounts($project_id) as $other) {
      if ((int) $other->id() === $exclude_id) {
        continue;
      }
      if ($default && $other->get('is_default')->value) {
        throw new \DomainException('This project already has a default billing account.');
      }
      if (array_intersect($tickets, WorkAssignments::linkedTickets($other)) !== []) {
        throw new \DomainException('This ticket is already linked to another billing account.');
      }
    }
  }

}
