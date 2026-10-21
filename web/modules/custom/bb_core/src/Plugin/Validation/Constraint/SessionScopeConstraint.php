<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates referenced ticket scope for session-scoped writes.
 */
#[Constraint(
  id: 'BbSessionScope',
  label: new TranslatableMarkup('bakers.build session scope'),
)]
final class SessionScopeConstraint extends SymfonyConstraint {

  /**
   * Violation message when referenced ticket is outside session scope.
   *
   * @var string
   */
  public string $messageOutOfScope = 'The referenced ticket is outside the active session scope.';

  /**
   * Violation message when a session-scoped write carries no ticket reference.
   *
   * @var string
   */
  public string $messageMissing = 'A session-scoped write requires a ticket reference inside the active session scope.';

  /**
   * Whether an empty field value is valid (e.g. optional parent reference).
   *
   * When TRUE an empty field bypasses all scope checks. When FALSE (the
   * default) a missing reference triggers the run-id fallback path and, if
   * that also yields nothing, a messageMissing violation.
   *
   * @var bool
   */
  public bool $allowEmpty = FALSE;

}
