<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\Validation\Constraint;

use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkTimeRules;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Cross-field and stored-state checks that field constraints cannot cover.
 */
final class WorklogConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    assert($constraint instanceof WorklogConstraint);
    if (!$value instanceof Worklog) {
      return;
    }

    try {
      WorkTimeRules::seconds((int) $value->get('duration_seconds')->value);
    }
    catch (\InvalidArgumentException) {
      $this->context->buildViolation($constraint->durationMessage)
        ->atPath('duration_seconds')
        ->addViolation();
    }

    $description = trim((string) $value->get('description')->value);
    if ($description === '') {
      $this->context->buildViolation($constraint->descriptionMessage)
        ->atPath('description')
        ->addViolation();
    }

    $ticket = $value->get('ticket_id')->target_id;
    $project = $value->get('project_id')->target_id;
    if ($ticket && !$project) {
      $this->context->buildViolation($constraint->ticketRequiresProjectMessage)
        ->atPath('ticket_id')
        ->addViolation();
    }
  }

}
