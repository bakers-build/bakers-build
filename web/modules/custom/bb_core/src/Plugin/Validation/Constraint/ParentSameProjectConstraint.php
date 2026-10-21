<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A newly set parent ticket must be in the ticket's own project.
 *
 * Applies on every write path (Web, JSON:API, CLI). A stored parent is not
 * checked again, so existing data and project moves stay valid.
 */
#[Constraint(
  id: 'BbParentSameProject',
  label: new TranslatableMarkup("bakers.build parent ticket is in the ticket's project"),
)]
final class ParentSameProjectConstraint extends SymfonyConstraint {

  /**
   * Violation message; it never names the parent, whose label may be private.
   *
   * @var string
   */
  public string $message = "The parent ticket must be in this ticket's project.";

}
