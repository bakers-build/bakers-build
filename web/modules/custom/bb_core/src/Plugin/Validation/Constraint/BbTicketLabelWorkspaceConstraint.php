<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates that every label on a ticket belongs to the ticket's workspace.
 *
 * Applied to bb_ticket.labels and bb_ticket_template.labels. The
 * workspace read scope narrows what a term COLLECTION returns; it does not
 * stop a write. Without this rule a caller naming a uuid it learned elsewhere
 * can label a ticket of workspace A
 * with a term of workspace B, and the row is then invisible to everyone in A.
 */
#[Constraint(
  id: 'BbTicketLabelWorkspace',
  label: new TranslatableMarkup('bakers.build ticket label workspace'),
)]
final class BbTicketLabelWorkspaceConstraint extends SymfonyConstraint {

  /**
   * Violation message for a label belonging to another workspace.
   *
   * @var string
   */
  public string $message = "Label %label belongs to workspace %label_workspace, not to this ticket's workspace %ticket_workspace.";

}
