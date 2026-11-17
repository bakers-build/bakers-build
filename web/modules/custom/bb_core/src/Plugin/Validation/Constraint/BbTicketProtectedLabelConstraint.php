<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates that the actor may add each new label of a protected namespace.
 *
 * Applied to bb_ticket.labels and bb_ticket_template.labels. The namespaces
 * are `bb_core.settings:protected_label_namespaces`; the permissions come from
 * ProtectedLabelPermissions and are held through a workspace rank.
 */
#[Constraint(
  id: 'BbTicketProtectedLabel',
  label: new TranslatableMarkup('bakers.build protected ticket label'),
)]
final class BbTicketProtectedLabelConstraint extends SymfonyConstraint {

  /**
   * Violation message for a protected label the actor may not add.
   *
   * @var string
   */
  public string $message = 'You may not add the protected label %label here.';

}
