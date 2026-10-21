<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Only an active conductor may be assigned to a ticket.
 */
#[Constraint(
  id: 'BbConductorActive',
  label: new TranslatableMarkup('Conductor is active'),
)]
final class ConductorActiveConstraint extends SymfonyConstraint {

  /**
   * The violation message.
   *
   * @var string
   */
  public string $message = '@label is inactive and cannot be assigned to this ticket.';

}
