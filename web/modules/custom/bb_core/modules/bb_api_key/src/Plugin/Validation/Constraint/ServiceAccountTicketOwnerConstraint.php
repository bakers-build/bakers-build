<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A service account may only author a new ticket as itself.
 *
 * Applied to `bb_ticket.owner_user_id`. A human write is untouched; only a
 * create by an authenticated service account is checked, since Reporter
 * carries no ticket-update permission, so creation is the one write path
 * that exists for it.
 */
#[Constraint(
  id: 'BbServiceAccountTicketOwner',
  label: new TranslatableMarkup('Service account ticket authorship'),
)]
final class ServiceAccountTicketOwnerConstraint extends SymfonyConstraint {

  /**
   * Violation message when a service account supplies a foreign owner.
   *
   * @var string
   */
  public string $message = 'A service account cannot author a ticket as a different owner.';

}
