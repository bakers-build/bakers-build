<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Submission state changes follow Submission::TRANSITIONS.
 */
#[Constraint(
  id: 'SubmissionState',
  label: new TranslatableMarkup('Submission state'),
)]
final class SubmissionStateConstraint extends SymfonyConstraint {

  /**
   * The requested state change is not allowed here.
   *
   * @var string
   */
  public string $message = 'This submission cannot change to %state.';

}
