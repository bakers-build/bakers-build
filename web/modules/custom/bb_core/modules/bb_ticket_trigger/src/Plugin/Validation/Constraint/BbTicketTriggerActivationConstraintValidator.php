<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\Validation\Constraint;

use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates BbTicketTriggerActivationConstraint.
 */
final class BbTicketTriggerActivationConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $trigger, Constraint $constraint): void {
    assert($constraint instanceof BbTicketTriggerActivationConstraint);
    if (!$trigger instanceof BbTicketTriggerInterface || !$trigger->isEnabled()) {
      return;
    }
    foreach ($trigger->getTypePlugin()->configurationErrors() as $error) {
      $this->context->buildViolation($error)->atPath('trigger_type')->addViolation();
    }
    $actor = $trigger->getActor();
    if ($actor === NULL) {
      $this->context->buildViolation($constraint->noActor)->atPath('actor_uid')->addViolation();
      return;
    }
    if ($trigger->getTarget() === NULL) {
      return;
    }
    $reason = $trigger->getTargetPlugin()->preflight($trigger, $actor);
    if ($reason !== NULL) {
      $this->context->buildViolation('The service account cannot run this trigger: @reason', ['@reason' => $reason])
        ->atPath('actor_uid')
        ->addViolation();
    }
  }

}
