<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\Validation\Constraint;

use Drupal\bb_track\Entity\Submission;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Reports a forbidden state change as a violation before saving.
 */
final class SubmissionStateConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    assert($constraint instanceof SubmissionStateConstraint);
    if ($value instanceof Submission && !$value->stateChangeAllowed()) {
      $this->context->buildViolation($constraint->message, ['%state' => $value->get('state')->value])
        ->atPath('state')
        ->addViolation();
    }
  }

}
