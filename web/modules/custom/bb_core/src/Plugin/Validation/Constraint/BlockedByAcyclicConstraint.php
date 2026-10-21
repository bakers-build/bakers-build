<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Ensures the ticket blocked_by graph stays acyclic.
 *
 * Applied to the blocked_by entity-reference field of BbTicket. Each time a
 * ticket is saved the validator traverses the blocker sub-graph and rejects any
 * reference that would introduce a cycle, keeping the dependency graph a
 * directed acyclic graph (DAG) at all times.
 */
#[Constraint(
  id: 'BbBlockedByAcyclic',
  label: new TranslatableMarkup('bakers.build blocked_by graph is acyclic'),
)]
final class BlockedByAcyclicConstraint extends SymfonyConstraint {

  /**
   * Violation message shown when a cycle-creating reference is detected.
   *
   * @var string
   */
  public string $message = 'Adding ticket %blocker as blocker would create a blocked_by cycle.';

}
