<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Rejects a target state outside TypeWorkflows::templateTargetStateOptions().
 *
 * Empty keeps the workflow's initial state and is always valid.
 */
final class BbTemplateTargetStateConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $template, Constraint $constraint): void {
    assert($constraint instanceof BbTemplateTargetStateConstraint);
    if (!$template instanceof BbTicketTemplateInterface) {
      return;
    }
    $state = $template->getTargetState();
    if ($state === '' || array_key_exists($state, TypeWorkflows::templateTargetStateOptions($template->getWorkflow()))) {
      return;
    }
    $this->context->buildViolation($constraint->message, ['%state' => $state])
      ->atPath('target_state')
      ->addViolation();
  }

}
