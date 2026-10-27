<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A conductor may be newly assigned only when its owner may take the work.
 */
#[Constraint(
  id: 'BbConductorOwnerAccess',
  label: new TranslatableMarkup('Conductor owner has access'),
)]
final class ConductorOwnerAccessConstraint extends SymfonyConstraint {

  /**
   * The violation message when the owner cannot access the project.
   *
   * @var string
   */
  public string $message = 'Conductor @label cannot be assigned: its owner has no access to this project.';

  /**
   * The violation message when the owner is not responsible for the ticket.
   *
   * @var string
   */
  public string $notResponsibleMessage = 'Conductor @label cannot be assigned: its owner is neither the assignee nor a reviewer of this ticket.';

}
