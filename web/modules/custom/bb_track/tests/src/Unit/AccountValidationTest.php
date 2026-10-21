<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Unit;

use Drupal\bb_track\AccountValidation;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Billing terms belong to their type; foreign or missing values are named.
 */
#[Group('bb_track')]
final class AccountValidationTest extends UnitTestCase {

  /**
   * Each combination reports exactly the fields that break a rule.
   *
   * @param array<string, mixed> $terms
   *   Terms differing from Time & Materials without budget.
   * @param list<string> $errors
   *   Expected field names with an error.
   */
  #[DataProvider('terms')]
  public function testTermsRulesPerType(array $terms, array $errors): void {
    $terms += [
      'billing_type' => 'time_material',
      'budget_kind' => 'none',
      'budget_value' => NULL,
      'budget_resets_monthly' => FALSE,
      'fixed_fee' => NULL,
      'hourly_rate' => NULL,
    ];
    self::assertSame($errors, array_keys(AccountValidation::terms($terms)));
  }

  /**
   * Rule table cases.
   *
   * @return array<string, array{array<string, mixed>, list<string>}>
   *   Terms and expected error fields.
   */
  public static function terms(): array {
    $hours = ['budget_kind' => 'hours', 'budget_value' => '10'];
    $amount = ['budget_kind' => 'amount', 'budget_value' => '10'];
    $reset = ['budget_resets_monthly' => TRUE];
    $fixed = ['billing_type' => 'fixed_fee', 'fixed_fee' => '1'];
    return [
      'T&M without budget' => [[], []],
      'T&M hours budget with reset' => [$hours + $reset, []],
      'T&M amount budget with rate and reset' => [$amount + $reset + ['hourly_rate' => '95'], []],
      'T&M zero rate' => [['hourly_rate' => '0'], []],
      'T&M with fixed fee' => [['fixed_fee' => '100'], ['fixed_fee']],
      'T&M value without budget kind' => [['budget_value' => '10'], ['budget_value']],
      'T&M hours budget without value' => [['budget_kind' => 'hours'], ['budget_value']],
      'T&M reset without budget' => [['budget_resets_monthly' => TRUE], ['budget_resets_monthly']],
      'T&M zero budget' => [['budget_kind' => 'hours', 'budget_value' => '0'], ['budget_value']],
      'negative rate' => [['hourly_rate' => '-1'], ['hourly_rate']],
      'non-numeric rate' => [['hourly_rate' => '1,5'], ['hourly_rate']],
      'rate beyond the column' => [['hourly_rate' => '10000000000'], ['hourly_rate']],
      'largest rate' => [['hourly_rate' => '9999999999.99'], []],
      'sub-cent fee' => [['billing_type' => 'fixed_fee', 'fixed_fee' => '0.004'], ['fixed_fee']],
      'rate as a JSON number' => [['hourly_rate' => 95.5], []],
      'rate with exponent' => [['hourly_rate' => '1e3'], ['hourly_rate']],
      'FF with fee' => [['billing_type' => 'fixed_fee', 'fixed_fee' => '1500', 'hourly_rate' => '80'], []],
      'FF without fee' => [['billing_type' => 'fixed_fee'], ['fixed_fee']],
      'FF zero fee' => [['billing_type' => 'fixed_fee', 'fixed_fee' => '0'], ['fixed_fee']],
      'FF hours budget with reset' => [$fixed + $hours + $reset, []],
      'FF amount budget with reset' => [$fixed + $amount + $reset, ['budget_resets_monthly']],
      'FF reset without budget' => [$fixed + $reset, ['budget_resets_monthly']],
      'FF amount budget without value' => [$fixed + ['budget_kind' => 'amount'], ['budget_value']],
      'NB bare' => [['billing_type' => 'non_billable'], []],
      'NB with budget kind' => [['billing_type' => 'non_billable', 'budget_kind' => 'hours'], ['budget_kind']],
      'NB with budget value' => [['billing_type' => 'non_billable', 'budget_value' => '5'], ['budget_value']],
      'NB with reset' => [['billing_type' => 'non_billable'] + $reset, ['budget_resets_monthly']],
      'NB with fee' => [['billing_type' => 'non_billable', 'fixed_fee' => '5'], ['fixed_fee']],
      'NB with rate' => [['billing_type' => 'non_billable', 'hourly_rate' => '90'], ['hourly_rate']],
      'unknown type' => [['billing_type' => 'internal'], ['billing_type']],
      'unknown budget kind' => [['budget_kind' => 'days'], ['budget_kind']],
    ];
  }

}
