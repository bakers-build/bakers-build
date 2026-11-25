<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Refuses a project identifier prefix that another project's tickets carry.
 *
 * Applied to the key field of BbProject. Tickets keep their identifier when
 * their project's prefix changes, so an old prefix stays reserved for as long
 * as a ticket of another project uses it.
 */
#[Constraint(
  id: 'BbProjectKeyReserved',
  label: new TranslatableMarkup('bakers.build project identifier prefix reserved'),
)]
final class BbProjectKeyReservedConstraint extends SymfonyConstraint {

  /**
   * Violation message when another project's tickets use the prefix.
   *
   * @var string
   */
  public string $message = "The identifier prefix %value is reserved: another project’s tickets use it.";

}
