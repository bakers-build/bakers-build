<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\bb_core\Entity\BbRunInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Rejects log_upload_omitted unless this save is a closing write with no log.
 */
final class RunLogOmissionConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    assert($constraint instanceof RunLogOmissionConstraint);
    if (!$value instanceof BbRunInterface) {
      return;
    }
    if (!$value->get('log_upload_omitted')->value) {
      return;
    }
    if (!$value->get('closed')->value) {
      $this->context->buildViolation($constraint->notClosingMessage)
        ->atPath('log_upload_omitted')
        ->addViolation();
    }
    if ($this->hasPayload($value, 'log')
      || $this->hasPayload($value, 'error_log')) {
      $this->context->buildViolation($constraint->payloadMessage)
        ->atPath('log_upload_omitted')
        ->addViolation();
    }
  }

  /**
   * Whether the given custom-storage log field carries a nonempty string.
   */
  private function hasPayload(BbRunInterface $run, string $field): bool {
    $payload = $run->get($field)->value;
    return is_string($payload) && $payload !== '';
  }

}
