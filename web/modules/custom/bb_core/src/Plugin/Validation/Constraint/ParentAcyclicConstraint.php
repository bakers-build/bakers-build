<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Ensures the ticket parent_id graph stays acyclic.
 *
 * Applied to the parent_id entity-reference field of BbTicket (BB-664
 * review F6: `blocked_by` already had this guard; `parent_id` became
 * editable on the Settings form without one). Each time a ticket is saved
 * the validator walks the candidate parent's own ancestor chain and rejects
 * a reference that would make the ticket its own ancestor, including the
 * direct self-parent case.
 */
#[Constraint(
  id: 'BbParentAcyclic',
  label: new TranslatableMarkup('bakers.build parent_id graph is acyclic'),
)]
final class ParentAcyclicConstraint extends SymfonyConstraint {

  /**
   * Violation message shown when a cycle-creating reference is detected.
   *
   * @var string
   */
  public string $message = 'Setting ticket %parent as parent would create a parent_id cycle.';

}
