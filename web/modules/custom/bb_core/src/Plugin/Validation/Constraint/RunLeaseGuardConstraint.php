<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates run lease integrity for conductor-scoped updates.
 */
#[Constraint(
  id: 'BbRunLeaseGuard',
  label: new TranslatableMarkup('bakers.build run lease guard'),
)]
final class RunLeaseGuardConstraint extends SymfonyConstraint {

  /**
   * Violation message when an attempt is made to re-activate a terminal run.
   *
   * @var string
   */
  public string $messageTerminal = 'A terminal run cannot be re-activated; re-claim the ticket.';

  /**
   * Violation message when the claim lease has already expired.
   *
   * @var string
   */
  public string $messageExpired = 'The claim lease is expired; re-claim the ticket instead of renewing.';

}
