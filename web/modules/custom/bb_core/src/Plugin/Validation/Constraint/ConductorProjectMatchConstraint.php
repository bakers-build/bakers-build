<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates that a ticket's conductor belongs to the ticket's project.
 *
 * Applied to the conductor_id field of BbTicket. A conductor whose project
 * differs from the ticket's project may not be assigned, and nor may one be
 * assigned to a ticket with no resolvable project. An empty conductor is a
 * no-op: clearing an assignment always validates.
 */
#[Constraint(
  id: 'BbConductorProjectMatch',
  label: new TranslatableMarkup('bakers.build conductor matches ticket project'),
)]
final class ConductorProjectMatchConstraint extends SymfonyConstraint {

  /**
   * Violation message when the conductor is in a different project.
   *
   * @var string
   */
  public string $message = 'The selected conductor belongs to a different project and cannot be assigned to this ticket.';

  /**
   * Violation message when the ticket has no resolvable project.
   *
   * @var string
   */
  public string $noProjectMessage = 'A conductor cannot be assigned before the ticket has a project.';

}
