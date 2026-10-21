<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Entity-level invariants for Worklog.
 */
#[Constraint(
  id: 'Worklog',
  label: new TranslatableMarkup('Worklog'),
)]
final class WorklogConstraint extends SymfonyConstraint {

  /**
   * Duration must be a whole positive minute.
   *
   * @var string
   */
  public string $durationMessage = 'Duration must be a positive whole number of minutes, at most 24:00.';

  /**
   * A ticket requires a project.
   *
   * @var string
   */
  public string $ticketRequiresProjectMessage = 'A ticket can only be recorded with a project.';

  /**
   * Description must contain non-whitespace text.
   *
   * @var string
   */
  public string $descriptionMessage = 'Enter a description of the work.';

}
