<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Restricts log_upload_omitted to a closing write with no new log payload.
 *
 * Applied to the whole bb_run because the rule spans the flag, closed, and
 * the log/error_log fields together.
 */
#[Constraint(
  id: 'BbRunLogOmission',
  label: new TranslatableMarkup('bakers.build run log omission'),
  type: ['entity:bb_run'],
)]
final class RunLogOmissionConstraint extends SymfonyConstraint {

  /**
   * Violation when the flag is set on a write that is not closing the run.
   *
   * @var string
   */
  public string $notClosingMessage = 'Log upload omitted is only allowed when closing a run.';

  /**
   * Violation when the flag is sent together with a log or error_log payload.
   *
   * @var string
   */
  public string $payloadMessage = 'Log upload omitted cannot be sent with a log or error_log payload.';

}
