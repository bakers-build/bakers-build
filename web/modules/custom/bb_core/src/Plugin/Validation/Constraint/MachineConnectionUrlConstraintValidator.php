<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\bb_core\Entity\BbMachineInterface;
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
    assert($value instanceof BbMachineInterface);
    foreach ($value->get('connection_url') as $delta => $item) {
      $url = $item->get('value')->getValue();
      if ($url !== NULL && !MachineConnectionUrl::isValid($url)) {
        $this->context->buildViolation($constraint->message)
          ->atPath('connection_url.' . $delta . '.value')
          ->addViolation();
      }
    }
  }

}
