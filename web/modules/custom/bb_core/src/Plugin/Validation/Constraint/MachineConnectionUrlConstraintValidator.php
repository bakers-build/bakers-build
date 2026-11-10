<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\TypedData\TypedDataInterface;
use Drupal\bb_core\Conductor\MachineConnectionUrl;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Applies the registration URL grammar to entity and JSON:API writes.
 */
final class MachineConnectionUrlConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    assert($constraint instanceof MachineConnectionUrlConstraint);
    if ($value instanceof TypedDataInterface) {
      $value = $value->getValue();
    }
    if ($value !== NULL && !MachineConnectionUrl::isValid($value)) {
      $this->context->addViolation($constraint->message);
    }
  }

}
