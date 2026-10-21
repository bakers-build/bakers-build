<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\Validation\Constraint;

use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates BbTicketTriggerTargetWorkspaceConstraint.
 */
final class BbTicketTriggerTargetWorkspaceConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $trigger, Constraint $constraint): void {
    assert($constraint instanceof BbTicketTriggerTargetWorkspaceConstraint);
    // A missing target or workspace is the required fields' violation.
    if (!$trigger instanceof BbTicketTriggerInterface || $trigger->getTarget() === NULL || $trigger->getWorkspace() === NULL) {
      return;
    }
    $target_workspace = $trigger->getTargetPlugin()->getWorkspace($trigger);
    if ((string) $target_workspace?->id() !== (string) $trigger->getWorkspace()->id()) {
      $this->context->buildViolation($constraint->message)->atPath('workspace_id')->addViolation();
    }
  }

}
