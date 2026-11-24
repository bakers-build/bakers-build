<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A newly set conductor needs an owner with access who allows the actor.
 */
#[Constraint(
  id: 'BbConductorOwnerAccess',
  label: new TranslatableMarkup('Conductor owner has access'),
)]
final class ConductorOwnerAccessConstraint extends SymfonyConstraint {

  /**
   * The violation message when the owner cannot access the project.
   *
   * @var string
   */
  public string $message = 'Conductor @label cannot be assigned: its owner has no access to this project.';

  /**
   * The violation message when the owner's setting forbids the actor.
   *
   * @var string
   */
  public string $forbiddenMessage = 'Conductor @label cannot be assigned: its owner @owner forbids assignment by others (@source setting).';

}
