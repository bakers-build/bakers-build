<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Entity-level invariants for a billing account, reported before saving.
 *
 * Mirrors the cheap AccountGuard checks so API writes get a validation error
 * instead of a storage exception; the guard stays the locked backstop.
 */
#[Constraint(
  id: 'BillingAccount',
  label: new TranslatableMarkup('Billing account'),
)]
final class BillingAccountConstraint extends SymfonyConstraint {

  /**
   * The name is blank.
   *
   * @var string
   */
  public string $nameMessage = 'Enter a name.';

  /**
   * The project default cannot be archived.
   *
   * @var string
   */
  public string $defaultMessage = 'Make another billing account the default before archiving this one.';

}
