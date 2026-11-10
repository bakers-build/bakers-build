<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Requires a public SSH or HTTPS machine address.
 */
#[Constraint(id: 'MachineConnectionUrl', label: new TranslatableMarkup('Machine connection URL'))]
final class MachineConnectionUrlConstraint extends SymfonyConstraint {

  /**
   * Value-free error: invalid addresses may contain credentials.
   */
  public string $message = 'Use a valid public SSH or HTTPS connection URL without a password.';

}
