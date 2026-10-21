<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkAssignments;

/**
 * The billing-account choice of a time form: resolved first, changeable after.
 *
 * A project or ticket pick re-resolves the account and preselects it; the
 * employee may then choose another active account of that project. A
 * later project or ticket change re-resolves again, dropping that choice.
 */
final class AccountChoice {

  use StringTranslationTrait;

  /**
   * Constructs the choice.
   */
  public function __construct(private readonly WorkAssignments $assignments) {}

  /**
   * Picker options: name and archived marker.
   *
   * @param array<int, \Drupal\bb_track\Entity\Account> $accounts
   *   Accounts keyed by id.
   *
   * @return array<int|string, string>
   *   Labels keyed by account id.
   */
  public static function options(array $accounts): array {
    $options = [];
    foreach ($accounts as $id => $account) {
      $label = (string) $account->label();
      if (!$account->get('active')->value) {
        $label .= ' (' . t('archived') . ')';
      }
      $options[(string) $id] = $label;
    }
    natcasesort($options);
    return $options;
  }

  /**
   * The picker (or an empty value) and, when nothing resolves, the message.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state; remembers the target the last choice was made for.
   * @param array<string, mixed> $input
   *   Raw user input of this one entry.
   * @param string $key
   *   Form-state key under which the last target is remembered.
   * @param int $project_id
   *   The selected project.
   * @param int|null $ticket_id
   *   The selected ticket.
   * @param \Drupal\bb_track\Entity\Worklog|null $entry
   *   The stored entry, or NULL.
   * @param list<string|int> $parents
   *   Input parents of the account element, to carry the preselection
   *   through a rebuild whose input lacks it.
   *
   * @return array{account: array<string, mixed>, account_missing: array<string, mixed>}
   *   The elements.
   */
  public function element(FormStateInterface $form_state, array $input, string $key, int $project_id, ?int $ticket_id, ?Worklog $entry, array $parents): array {
    [$selected, $message, $from_input] = $this->preselected($form_state, $input, $key, $project_id, $ticket_id, $entry);
    if (!$from_input && $form_state->getUserInput() !== []) {
      // With input present, Form API ignores #default_value: write it in.
      $all = $form_state->getUserInput();
      NestedArray::setValue($all, $parents, $selected === NULL ? [] : [$selected]);
      $form_state->setUserInput($all);
    }
    $accounts = $this->assignments->activeAccounts($project_id);
    $stored = $entry?->get('account_id')->entity;
    if ($stored instanceof Account && (string) $stored->id() === $selected) {
      $accounts[(int) $stored->id()] = $stored;
    }
    $options = self::options($accounts);
    $missing = $message ?? ($options === [] ? WorkAssignments::NONE_CONFIGURED : NULL);
    return [
      'account' => $options === []
        ? ['#type' => 'value', '#value' => []]
        : WorklogFormLayout::picker((string) $this->t('Billing account'), 'tag', $options, isset($options[$selected]) ? [$selected] : []),
      'account_missing' => $missing === NULL ? [] : ['#type' => 'item', '#markup' => $missing],
    ];
  }

  /**
   * The checked chosen account, or the resolved one, for a validated target.
   *
   * An unmoved entry keeps its stored account unless another was chosen:
   * its project or ticket may since have become unloadable, and its account
   * archived.
   *
   * @throws \DomainException
   *   The resolver's message.
   */
  public function accountId(int $project_id, ?int $ticket_id, mixed $value, ?Worklog $existing): int {
    $chosen = WorklogFormLayout::selectedProjectId($value);
    $stored = $existing?->get('account_id')->target_id ? (int) $existing->get('account_id')->target_id : NULL;
    $unmoved = self::target($existing) === $project_id . ':' . (int) $ticket_id;
    if ($stored !== NULL && $unmoved && in_array($chosen, [NULL, $stored], TRUE)) {
      return $stored;
    }
    return $this->assignments->assignment($project_id, $ticket_id, $chosen)['id'];
  }

  /**
   * The account to preselect, and the resolver's message when there is none.
   *
   * The employee's choice for this same target, else the stored account of
   * an unmoved entry, else the target's resolved account.
   *
   * @return array{0: string|null, 1: string|null, 2: bool}
   *   The preselected account id, the message, and whether it came from
   *   the employee's input.
   */
  private function preselected(FormStateInterface $form_state, array $input, string $key, int $project_id, ?int $ticket_id, ?Worklog $entry): array {
    $target = $project_id . ':' . (int) $ticket_id;
    // No remembered target yet means no project change happened: a posted
    // account then is the employee's choice, not a stale one.
    $previous = $form_state->get($key);
    $same_target = $previous === NULL || $previous === $target;
    $form_state->set($key, $target);
    $chosen = WorklogFormLayout::selectedProjectId($input['account'] ?? NULL);
    if ($same_target && $chosen) {
      return [(string) $chosen, NULL, TRUE];
    }
    $stored = $entry?->get('account_id')->target_id;
    if ($stored && self::target($entry) === $target) {
      return [(string) $stored, NULL, FALSE];
    }
    try {
      return [(string) $this->assignments->assignment($project_id, $ticket_id)['id'], NULL, FALSE];
    }
    catch (\DomainException $error) {
      return [NULL, $error->getMessage(), FALSE];
    }
  }

  /**
   * The stored "project:ticket" key of an entry.
   */
  private static function target(?Worklog $entry): ?string {
    return $entry instanceof Worklog
      ? (int) $entry->get('project_id')->target_id . ':' . (int) $entry->get('ticket_id')->target_id
      : NULL;
  }

}
