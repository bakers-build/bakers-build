<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\bb_track\Entity\Account;

/**
 * Stateless content checks shared by every billing-account writer.
 */
final class AccountValidation {

  /**
   * The billing-term fields, written together by WorkAssignments.
   */
  public const array TERMS = [
    'billing_type',
    'budget_kind',
    'budget_value',
    'budget_resets_monthly',
    'fixed_fee',
    'hourly_rate',
  ];

  /**
   * Amount fields and their lower bound: exclusive when TRUE.
   */
  private const array AMOUNTS = ['budget_value' => TRUE, 'fixed_fee' => TRUE, 'hourly_rate' => FALSE];

  /**
   * Field labels used in the messages.
   */
  private const array LABELS = [
    'budget_kind' => 'budget',
    'budget_value' => 'budget value',
    'budget_resets_monthly' => 'monthly budget reset',
    'fixed_fee' => 'fixed fee',
    'hourly_rate' => 'hourly rate',
  ];

  /**
   * Validates name, optional external ID and terms before configuration writes.
   */
  public static function values(array $values): string {
    if (array_diff(array_keys($values), ['name', 'external_id', 'active', ...self::TERMS])) {
      throw new \InvalidArgumentException('Unknown billing-account field.');
    }
    self::types($values);
    $name = trim($values['name']);
    if ($name === '' || mb_strlen($name) > 255) {
      throw new \InvalidArgumentException('Enter a name.');
    }
    if (isset($values['external_id']) && mb_strlen($values['external_id']) > 255) {
      throw new \InvalidArgumentException('External ID must be 255 characters or fewer.');
    }
    return $name;
  }

  /**
   * Rejects coercion of configuration values at the application boundary.
   */
  private static function types(array $values): void {
    if (!is_string($values['name'] ?? NULL)) {
      throw new \InvalidArgumentException('Billing account name must be text.');
    }
    if (isset($values['external_id']) && !is_string($values['external_id'])) {
      throw new \InvalidArgumentException('Billing account external ID must be text.');
    }
    if (isset($values['active']) && !is_bool($values['active'])) {
      throw new \InvalidArgumentException('Billing account flags must be boolean.');
    }
    self::termTypes($values);
  }

  /**
   * Rejects coerced billing terms: text lists and amounts, a boolean reset.
   */
  private static function termTypes(array $values): void {
    if (isset($values['budget_resets_monthly']) && !is_bool($values['budget_resets_monthly'])) {
      throw new \InvalidArgumentException('Billing account flags must be boolean.');
    }
    foreach (['billing_type', 'budget_kind', ...array_keys(self::AMOUNTS)] as $name) {
      if (isset($values[$name]) && !is_string($values[$name])) {
        throw new \InvalidArgumentException(isset(self::AMOUNTS[$name])
          ? 'Billing account amounts must be numbers.'
          : 'Billing account type and budget must be text.');
      }
    }
  }

  /**
   * Checks the billing terms against their type.
   *
   * @param array<string, mixed> $terms
   *   The six TERMS; NULL amounts, FALSE reset and kind `none` mean unset.
   *
   * @return array<string, string>
   *   Messages keyed by field name, in field order; empty when valid.
   */
  public static function terms(array $terms): array {
    $type = $terms['billing_type'] ?? NULL;
    if (!in_array($type, ['time_material', 'fixed_fee', 'non_billable'], TRUE)) {
      return ['billing_type' => 'Choose Time & Materials, Fixed Fee or Non-Billable.'];
    }
    $kind = $terms['budget_kind'] ?? NULL;
    if (!in_array($kind, ['none', 'hours', 'amount'], TRUE)) {
      return ['budget_kind' => 'Choose no budget, hours or amount.'];
    }
    $set = array_keys(array_filter([
      'budget_kind' => $kind !== 'none',
      'budget_value' => ($terms['budget_value'] ?? NULL) !== NULL,
      'budget_resets_monthly' => (bool) ($terms['budget_resets_monthly'] ?? FALSE),
      'fixed_fee' => ($terms['fixed_fee'] ?? NULL) !== NULL,
      'hourly_rate' => ($terms['hourly_rate'] ?? NULL) !== NULL,
    ]));
    $errors = $type === 'non_billable' ? self::nonBillable($set) : self::billable($type, $kind, $set) + self::bounds($terms);
    // Field order, so the guard's first message is deterministic.
    return array_intersect_key(array_merge(array_fill_keys(self::TERMS, ''), $errors), $errors);
  }

  /**
   * Every set term is foreign to a Non-Billable account.
   *
   * @param list<string> $set
   *   The terms carrying a value.
   *
   * @return array<string, string>
   *   Messages keyed by field name.
   */
  private static function nonBillable(array $set): array {
    $errors = [];
    foreach ($set as $name) {
      $errors[$name] = 'Non-Billable accounts carry no ' . self::LABELS[$name] . '.';
    }
    return $errors;
  }

  /**
   * The fee, budget and reset rules of Time & Materials and Fixed Fee.
   *
   * @param string $type
   *   Either time_material or fixed_fee.
   * @param string $kind
   *   The budget kind.
   * @param list<string> $set
   *   The terms carrying a value.
   *
   * @return array<string, string>
   *   Messages keyed by field name.
   */
  private static function billable(string $type, string $kind, array $set): array {
    $fixed = $type === 'fixed_fee';
    $budget = $kind !== 'none';
    $errors = [];
    if ($fixed !== in_array('fixed_fee', $set, TRUE)) {
      $errors['fixed_fee'] = $fixed ? 'Enter the fixed fee.' : 'Time & Materials accounts carry no fixed fee.';
    }
    if ($budget !== in_array('budget_value', $set, TRUE)) {
      $errors['budget_value'] = $budget ? 'Enter the budget value.' : 'Choose hours or amount for the budget value.';
    }
    if (in_array('budget_resets_monthly', $set, TRUE) && !($fixed ? $kind === 'hours' : $budget)) {
      $errors['budget_resets_monthly'] = $fixed ? 'A monthly reset needs an hours budget.' : 'A monthly reset needs a budget.';
    }
    return $errors;
  }

  /**
   * The stored terms of an account, in the shape terms() reads.
   *
   * @return array<string, mixed>
   *   The six TERMS.
   */
  public static function termsOf(Account $billing_account): array {
    $terms = [];
    foreach (self::TERMS as $name) {
      $terms[$name] = $billing_account->get($name)->value;
    }
    $terms['budget_resets_monthly'] = (bool) $terms['budget_resets_monthly'];
    return $terms;
  }

  /**
   * Rejects amounts that are not two-decimal numbers or out of range.
   *
   * @param array<string, mixed> $terms
   *   The terms.
   *
   * @return array<string, string>
   *   Messages keyed by field name.
   */
  private static function bounds(array $terms): array {
    $errors = [];
    foreach (self::AMOUNTS as $name => $exclusive) {
      $error = self::amountError($terms[$name] ?? NULL, $exclusive);
      if ($error !== NULL) {
        $errors[$name] = ucfirst(self::LABELS[$name]) . $error;
      }
    }
    return $errors;
  }

  /**
   * Why an amount is invalid, as a message tail, or NULL when it is valid.
   *
   * The decimal(12,2) column would otherwise round or overflow after the
   * check. JSON:API may carry a JSON number.
   */
  private static function amountError(mixed $value, bool $exclusive): ?string {
    $value = is_int($value) || is_float($value) ? (string) $value : $value;
    return match (TRUE) {
      $value === NULL => NULL,
      !is_string($value) || !preg_match('/^-?\d+(\.\d{1,2})?$/', $value) => ' must be a number with at most two decimals.',
      abs((float) $value) >= 1e10 => ' is too large.',
      $exclusive && (float) $value <= 0 => ' must be greater than zero.',
      (float) $value < 0 => ' cannot be negative.',
      default => NULL,
    };
  }

}
