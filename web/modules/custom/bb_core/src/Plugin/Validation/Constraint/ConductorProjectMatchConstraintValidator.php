<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates that a ticket's conductor belongs to the ticket's project.
 */
final class ConductorProjectMatchConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof ConductorProjectMatchConstraint);
    $ticket = $items->getEntity();
    if (!$ticket instanceof BbTicketInterface && !$ticket instanceof BbTicketTemplateInterface) {
      return;
    }
    // No conductor assigned → nothing to check (clearing is always allowed).
    $conductor = $items->first()?->entity;
    if (!$conductor instanceof BbConductorInterface) {
      return;
    }
    // A conductor cannot be assigned without a resolvable ticket project to
    // match it against (AC-4): there is nothing to validate the assignment
    // against, so the safe answer is refusal, not a silent pass.
    $ticketProject = $ticket->get('project_id')->target_id;
    if ($ticketProject === NULL || $ticketProject === '') {
      $this->context->addViolation($constraint->noProjectMessage);
      return;
    }
    $conductorProject = $conductor->get('project_id')->target_id;
    if ((int) $conductorProject !== (int) $ticketProject) {
      $this->context->addViolation($constraint->message);
    }
  }

}
