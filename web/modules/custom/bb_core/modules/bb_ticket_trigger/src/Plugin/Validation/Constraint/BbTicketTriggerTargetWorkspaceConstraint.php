<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A trigger's target lies in the workspace the trigger is anchored in.
 *
 * The tenancy fence follows `workspace_id`, so a trigger anchored in A must
 * not act on a target in B.
 */
#[Constraint(
  id: 'BbTicketTriggerTargetWorkspace',
  label: new TranslatableMarkup('bakers.build ticket trigger target workspace'),
  type: ['entity'],
)]
final class BbTicketTriggerTargetWorkspaceConstraint extends SymfonyConstraint {

  /**
   * The violation message.
   *
   * @var string
   */
  public string $message = "The trigger's target is not in the trigger's workspace.";

}
