<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates that every environment on a ticket belongs to the ticket's project.
 *
 * Applied to bb_ticket.environments. bb_environment carries
 * project_id and no workspace_id, so this is a one-hop project comparison
 * against the ticket's own project_id, unlike the three-hop workspace walk
 * BbTicketLabelWorkspace performs for labels.
 */
#[Constraint(
  id: 'BbTicketEnvironmentProject',
  label: new TranslatableMarkup('bakers.build ticket environment project'),
)]
final class BbTicketEnvironmentProjectConstraint extends SymfonyConstraint {

  /**
   * Violation message for an environment belonging to another project.
   *
   * @var string
   */
  public string $message = "Environment %environment belongs to project %environment_project, not to this ticket's project %ticket_project.";

}
