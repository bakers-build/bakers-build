<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates conductor owner integrity for conductor-scoped accounts.
 *
 * Applied to the owner_user_id field of BbConductor. Enforces two rules:
 * on creation the owner must be the currently authenticated account; after
 * initial save the owner field is immutable and cannot be reassigned.
 */
#[Constraint(
  id: 'BbConductorOwner',
  label: new TranslatableMarkup('bakers.build conductor owner integrity'),
)]
final class ConductorOwnerConstraint extends SymfonyConstraint {

  /**
   * Violation message when a new conductor is not owned by the current user.
   *
   * @var string
   */
  public string $messageNotSelf = 'Conductor registrations must be owned by the authenticated account.';

  /**
   * Violation message when an existing conductor's owner is changed.
   *
   * @var string
   */
  public string $messageLocked = 'The conductor owner cannot be changed.';

}
