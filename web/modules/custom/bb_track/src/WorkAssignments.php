<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_track\Access\WorklogFormAccess;
use Drupal\bb_track\Entity\Account;

/**
 * Project-scoped billing-account configuration and assignment resolution.
 *
 * A project has several billing accounts and exactly one active default. A
 * ticket is linked by at most one active account; an unlinked ticket uses
 * its nearest linked ancestor's account, else the project default. Archived
 * accounts never count.
 *
 * The one service every account writer and reader goes through, so its
 * writes share one lock and its reads one resolver; splitting it would
 * give the default and the ticket links two homes.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class WorkAssignments {

  /**
   * Message when no active account covers a target.
   */
  public const string NONE_CONFIGURED = 'No billing account is configured for this project or ticket. Ask a project maintainer to set one.';

  /**
   * Constructs the application service.
   */
  public function __construct(
    private EntityTypeManagerInterface $entities,
    private WorkTimeMutation $mutation,
    private AccountProxyInterface $account,
    private WorkTimeRecords $records,
  ) {}

  /**
   * Saves authorized billing accounts; content is validated by the storage.
   *
   * Name, external ID, active and billing terms only: the default is moved
   * by makeDefault() and ticket links by linkTicket(). An omitted external ID
   * preserves the stored value; an explicit empty one clears it. A posted
   * billing_type writes all terms, absent ones unset, so no foreign value
   * survives a type change; without it the stored terms stay.
   */
  public function saveAccount(int $project_id, array $values, ?int $id = NULL): Account {
    $this->records->owner();
    return $this->mutation->run('assignments', function () use ($project_id, $values, $id): Account {
      $this->configurableProject($project_id);
      $storage = $this->entities->getStorage('bb_track_account');
      $billing_account = $id === NULL ? $storage->create([
        'project_id' => $project_id,
      ]) : $storage->loadUnchanged($id);
      if (!$billing_account instanceof Account || (int) $billing_account->get('project_id')->target_id !== $project_id) {
        throw new \DomainException('Billing account does not belong to this project.');
      }
      $name = AccountValidation::values($values);
      $billing_account->set('name', $name)->set('active', (bool) ($values['active'] ?? TRUE));
      if (array_key_exists('external_id', $values)) {
        $billing_account->set('external_id', $values['external_id']);
      }
      if (array_key_exists('billing_type', $values)) {
        $values += ['budget_kind' => 'none', 'budget_resets_monthly' => FALSE];
        foreach (AccountValidation::TERMS as $name) {
          $billing_account->set($name, $values[$name] ?? NULL);
        }
      }
      $billing_account->save();
      return $billing_account;
    });
  }

  /**
   * Makes an active, unlinked account of the project its default.
   *
   * The previous default is unset first, in the same transaction, so the
   * guard's one-default rule never sees two.
   */
  public function makeDefault(int $project_id, int $account_id): Account {
    $this->records->owner();
    return $this->mutation->run('assignments', function () use ($project_id, $account_id): Account {
      $this->configurableProject($project_id);
      $billing_account = $this->activeAccounts($project_id)[$account_id] ?? NULL;
      if (!$billing_account instanceof Account) {
        throw new \DomainException('Billing account is unavailable or belongs to another project.');
      }
      $current = $this->defaultAccount($project_id);
      if ($current instanceof Account && (int) $current->id() !== $account_id) {
        $current->set('is_default', FALSE)->save();
      }
      $billing_account->set('is_default', TRUE)->save();
      return $billing_account;
    });
  }

  /**
   * Links a ticket to an account of its project, or unlinks it (NULL).
   *
   * Removes the ticket from whichever active account links it, then adds it
   * to the chosen one. Fails without writing when the link changed since
   * the caller showed it ($shown: the account id it showed, 0 for none).
   */
  public function linkTicket(int $ticket_id, ?int $account_id, int $shown): void {
    $this->records->owner();
    $this->mutation->run('assignments', function () use ($ticket_id, $account_id, $shown): void {
      $project_id = $this->linkableProjectId($ticket_id);
      $linked = $this->linkedAccount($project_id, $ticket_id);
      if ((int) $linked?->id() !== $shown) {
        throw new \DomainException('The billing account of this ticket changed elsewhere. Reload the page and try again.');
      }
      $chosen = $this->chosenLinkTarget($project_id, $account_id);
      if ($linked instanceof Account && $linked->id() === $chosen?->id()) {
        return;
      }
      $this->unlinkTicket($linked, $ticket_id);
      $this->relinkTicket($chosen, $ticket_id);
    });
  }

  /**
   * The ticket's project, once its visibility and configurability are known.
   */
  private function linkableProjectId(int $ticket_id): int {
    $ticket = $this->entities->getStorage('bb_ticket')->loadUnchanged($ticket_id);
    if (!$ticket instanceof ContentEntityInterface || !$ticket->access('view', $this->account)) {
      throw new \DomainException('Ticket is unavailable.');
    }
    $project_id = (int) $ticket->get('project_id')->target_id;
    $this->configurableProject($project_id);
    return $project_id;
  }

  /**
   * The account a link picks, or NULL to unlink; rejects an unusable one.
   */
  private function chosenLinkTarget(int $project_id, ?int $account_id): ?Account {
    if ($account_id === NULL) {
      return NULL;
    }
    $chosen = $this->activeAccounts($project_id)[$account_id] ?? NULL;
    if (!$chosen instanceof Account) {
      throw new \DomainException('Billing account is unavailable or belongs to another project.');
    }
    return $chosen;
  }

  /**
   * Removes a ticket from the account that previously linked it, if any.
   */
  private function unlinkTicket(?Account $linked, int $ticket_id): void {
    if (!$linked instanceof Account) {
      return;
    }
    $remaining = array_values(array_filter(
      array_column($linked->get('tickets')->getValue(), 'target_id'),
      static fn ($id) => (int) $id !== $ticket_id,
    ));
    $linked->set('tickets', $remaining)->save();
  }

  /**
   * Adds a ticket to the newly chosen account, if one was chosen.
   */
  private function relinkTicket(?Account $chosen, int $ticket_id): void {
    if (!$chosen instanceof Account) {
      return;
    }
    $chosen->get('tickets')->appendItem($ticket_id);
    $chosen->save();
  }

  /**
   * The project's active default account, or NULL when none is active.
   *
   * @param int $project_id
   *   The project.
   * @param array<int, \Drupal\bb_track\Entity\Account>|null $accounts
   *   Its active accounts when the caller already loaded them.
   */
  public function defaultAccount(int $project_id, ?array $accounts = NULL): ?Account {
    foreach ($accounts ?? $this->activeAccounts($project_id) as $billing_account) {
      if ($billing_account->get('is_default')->value) {
        return $billing_account;
      }
    }
    return NULL;
  }

  /**
   * The active account that links this ticket itself, or NULL.
   */
  public function linkedAccount(int $project_id, int $ticket_id): ?Account {
    foreach ($this->activeAccounts($project_id) as $billing_account) {
      if (in_array($ticket_id, self::linkedTickets($billing_account), TRUE)) {
        return $billing_account;
      }
    }
    return NULL;
  }

  /**
   * The ticket ids an account links.
   *
   * @return list<int>
   *   Ticket ids.
   */
  public static function linkedTickets(Account $billing_account): array {
    return array_map('intval', array_column($billing_account->get('tickets')->getValue(), 'target_id'));
  }

  /**
   * The account that applies to a ticket and the ticket that links it.
   *
   * Unauthorized: callers show it only to someone who may view the ticket.
   *
   * @return array{0: ?\Drupal\bb_track\Entity\Account, 1: ?int}
   *   The account (NULL when none is configured) and the linking ticket id:
   *   the ticket itself, an ancestor, or NULL for the project default.
   */
  public function resolution(int $project_id, ?int $ticket_id): array {
    $accounts = $this->activeAccounts($project_id);
    $by_ticket = self::linkMap($accounts);
    foreach ($this->ancestry($project_id, $ticket_id) as $target) {
      if (isset($by_ticket[$target])) {
        return [$by_ticket[$target], $target];
      }
    }
    return [$this->defaultAccount($project_id, $accounts), NULL];
  }

  /**
   * The account that applies to each of many tickets of one project.
   *
   * The same rule as resolution(), with the project's accounts loaded once.
   * A ticket whose ancestry is inconsistent falls back to the project
   * default, so a report over many tickets never fails on one of them.
   *
   * @param int $project_id
   *   The project.
   * @param list<int> $ticket_ids
   *   Tickets of that project.
   *
   * @return array<int, ?\Drupal\bb_track\Entity\Account>
   *   The account per ticket id, NULL when none is configured.
   */
  public function resolutions(int $project_id, array $ticket_ids): array {
    $accounts = $this->activeAccounts($project_id);
    $by_ticket = self::linkMap($accounts);
    $default = $this->defaultAccount($project_id, $accounts);
    $result = [];
    foreach ($ticket_ids as $ticket_id) {
      $result[$ticket_id] = $default;
      try {
        foreach ($this->ancestry($project_id, $ticket_id) as $target) {
          if (isset($by_ticket[$target])) {
            $result[$ticket_id] = $by_ticket[$target];
            break;
          }
        }
      }
      catch (\DomainException) {
        // Inconsistent ancestry: the project default applies.
      }
    }
    return $result;
  }

  /**
   * The active account linking each ticket of a project, first by id.
   *
   * @param array<int, \Drupal\bb_track\Entity\Account> $accounts
   *   Active accounts of one project.
   *
   * @return array<int, \Drupal\bb_track\Entity\Account>
   *   Accounts keyed by the ticket id they link.
   */
  private static function linkMap(array $accounts): array {
    $by_ticket = [];
    foreach ($accounts as $billing_account) {
      foreach (self::linkedTickets($billing_account) as $linked) {
        $by_ticket[$linked] ??= $billing_account;
      }
    }
    return $by_ticket;
  }

  /**
   * Requires project update access for configuration writes.
   */
  private function configurableProject(int $project_id): void {
    $project = $this->entities->getStorage('bb_project')->loadUnchanged($project_id);
    if (!$project || !$project->access('update', $this->account)) {
      throw new \DomainException('You cannot configure billing accounts for this project.');
    }
  }

  /**
   * Creates the project's default Internal profile, unauthorized.
   *
   * Called from the project creation lifecycle, which has no interactive
   * actor to check update access against. Idempotent: a project that
   * already has an active default (a race, or a caller that ran this twice)
   * returns it instead of racing the storage's one-default guard.
   */
  public function createDefaultAccount(BbProjectInterface $project): Account {
    $existing = $this->defaultAccount((int) $project->id());
    if ($existing instanceof Account) {
      return $existing;
    }
    $billing_account = $this->entities->getStorage('bb_track_account')->create([
      'name' => $project->label(),
      'project_id' => $project->id(),
      'is_default' => TRUE,
    ]);
    $billing_account->save();
    assert($billing_account instanceof Account);
    return $billing_account;
  }

  /**
   * Resolves, or checks an explicitly chosen, billing account for a target.
   *
   * @param int $project_id
   *   The project.
   * @param int|null $ticket_id
   *   The ticket, or NULL.
   * @param int|null $account_id
   *   An account the employee chose, or NULL to resolve the target's one.
   *
   * @return array<string, mixed>
   *   The account summary.
   */
  public function assignment(int $project_id, ?int $ticket_id, ?int $account_id = NULL): array {
    [$project, $targets] = $this->recordingTarget($project_id, $ticket_id);
    $billing_account = $account_id === NULL
      ? $this->resolveAccount($project_id, $targets[0] ?? NULL)
      : $this->chosenAccount($project_id, $account_id);
    return [
      'id' => (int) $billing_account->id(),
      'uuid' => $billing_account->uuid(),
      'name' => $billing_account->label(),
      'external_id' => (string) ($billing_account->get('external_id')->value ?? ''),
      'active' => (bool) $billing_account->get('active')->value,
      'project' => $project->label(),
      'project_uuid' => $project->uuid(),
    ];
  }

  /**
   * Lists accounts visible for the selected project.
   *
   * @return array<int, \Drupal\bb_track\Entity\Account>
   *   Accounts keyed by id.
   */
  public function accounts(?int $project_id = NULL): array {
    $result = [];
    $properties = $project_id === NULL ? [] : [
      'project_id' => $project_id,
    ];
    foreach ($this->entities->getStorage('bb_track_account')->loadByProperties($properties) as $billing_account) {
      assert($billing_account instanceof Account);
      if ($billing_account->access('view', $this->account)) {
        $result[(int) $billing_account->id()] = $billing_account;
      }
    }
    return $result;
  }

  /**
   * Active accounts of a project, unauthorized, fresh from storage.
   *
   * @return array<int, \Drupal\bb_track\Entity\Account>
   *   Accounts keyed by id.
   */
  public function activeAccounts(int $project_id): array {
    $storage = $this->entities->getStorage('bb_track_account');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('project_id', $project_id)->condition('active', 1)->sort('id')->execute();
    $result = [];
    foreach ($ids as $id) {
      // Not resetCache(): that clears the shared cache_entity bin, on every
      // ticket view and inside the account lock. loadUnchanged() drops only
      // this request's copy; saves invalidate the persistent one.
      $billing_account = $storage->loadUnchanged($id);
      assert($billing_account instanceof Account);
      $result[(int) $id] = $billing_account;
    }
    return $result;
  }

  /**
   * Returns a permitted project and valid nearest-first ticket ancestry.
   */
  private function validateTarget(int $project_id, ?int $ticket_id): array {
    $project = $this->entities->getStorage('bb_project')->load($project_id);
    if (!$project instanceof BbProjectInterface || !$project->access('view', $this->account)) {
      throw new \DomainException('Project is unavailable for recording.');
    }
    $targets = [];
    foreach ($this->ancestry($project_id, $ticket_id) as $ancestor_id) {
      $ticket = $this->entities->getStorage('bb_ticket')->load($ancestor_id);
      if (!$ticket instanceof ContentEntityInterface || !$ticket->access('view', $this->account)) {
        throw new \DomainException('Ticket is unavailable or belongs to another project.');
      }
      $targets[] = $ancestor_id;
    }
    return [$project, $targets];
  }

  /**
   * Resolves the account for an already-stored, already-authorized entry.
   *
   * Used by the storage-level invariant guard, which runs for every write
   * path and must not impose a per-actor recording authorization: that was
   * already enforced by whichever interactive caller is actually recording.
   */
  public function resolveAccountId(int $project_id, ?int $ticket_id, ?int $account_id = NULL): int {
    if (!$this->entities->getStorage('bb_project')->load($project_id) instanceof BbProjectInterface) {
      throw new \DomainException('Project is unavailable for recording.');
    }
    $billing_account = $account_id === NULL
      ? $this->resolveAccount($project_id, $ticket_id)
      : $this->chosenAccount($project_id, $account_id);
    return (int) $billing_account->id();
  }

  /**
   * Checks an explicitly chosen account: same project, active; unauthorized.
   */
  private function chosenAccount(int $project_id, int $account_id): Account {
    $billing_account = $this->activeAccounts($project_id)[$account_id] ?? NULL;
    if (!$billing_account instanceof Account) {
      throw new \DomainException('Billing account is unavailable or belongs to another project.');
    }
    return $billing_account;
  }

  /**
   * Nearest-first ticket ancestry, the ticket itself first, unauthorized.
   *
   * @return array<int>
   *   Ticket ids.
   */
  public function ancestry(int $project_id, ?int $ticket_id): array {
    $targets = [];
    $visited = [];
    while ($ticket_id) {
      if (isset($visited[$ticket_id]) || count($visited) >= 100) {
        throw new \DomainException('Ticket ancestry is inconsistent.');
      }
      $visited[$ticket_id] = TRUE;
      $ticket = $this->entities->getStorage('bb_ticket')->load($ticket_id);
      if (!$ticket instanceof ContentEntityInterface || (int) $ticket->get('project_id')->target_id !== $project_id) {
        throw new \DomainException('Ticket is unavailable or belongs to another project.');
      }
      $targets[] = $ticket_id;
      $ticket_id = $ticket->get('parent_id')->target_id ? (int) $ticket->get('parent_id')->target_id : NULL;
    }
    return $targets;
  }

  /**
   * Requires recording authority independently of settings access.
   */
  public function recordingTarget(int $project_id, ?int $ticket_id): array {
    [$project, $targets] = $this->validateTarget($project_id, $ticket_id);
    if (!WorklogFormAccess::canRecordOnProject($this->account, $project)) {
      throw new \DomainException('Project is unavailable for recording.');
    }
    return [$project, $targets];
  }

  /**
   * The resolved account, failing explicitly when none is configured.
   */
  private function resolveAccount(int $project_id, ?int $ticket_id): Account {
    [$billing_account] = $this->resolution($project_id, $ticket_id);
    if (!$billing_account instanceof Account) {
      throw new \DomainException(self::NONE_CONFIGURED);
    }
    return $billing_account;
  }

}
