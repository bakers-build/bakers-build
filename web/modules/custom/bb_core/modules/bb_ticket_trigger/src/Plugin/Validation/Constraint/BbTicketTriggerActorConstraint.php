<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A trigger executes only as an active service account of its workspace.
 *
 * So a template manager can never make background creation run as
 * themselves, uid 1, another human or another workspace's account.
 */
#[Constraint(
  id: 'BbTicketTriggerActor',
  label: new TranslatableMarkup('bakers.build ticket trigger execution account'),
)]
final class BbTicketTriggerActorConstraint extends SymfonyConstraint {

  /**
   * The violation message.
   *
   * @var string
   */
  public string $message = 'The service account must be an active service account of this workspace.';

}
