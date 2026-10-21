<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\Validation\Constraint;

use Drupal\Core\Entity\Plugin\Validation\Constraint\CompositeConstraintBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;

/**
 * An enabled trigger must be able to run.
 *
 * Available type, valid configuration, an execution account, and an account
 * the target's preflight accepts (for `template`: an enabled template the
 * instantiator would let it use). A
 * disabled trigger may be saved without them; it is never activated silently.
 */
#[Constraint(
  id: 'BbTicketTriggerActivation',
  label: new TranslatableMarkup('bakers.build ticket trigger activation'),
  type: ['entity'],
)]
final class BbTicketTriggerActivationConstraint extends CompositeConstraintBase {

  /**
   * Violation message when no execution account is set.
   *
   * @var string
   */
  public string $noActor = 'Choose a service account before enabling the trigger.';

  /**
   * {@inheritdoc}
   */
  public function coversFields(): array {
    return ['enabled', 'trigger_type', 'actor_uid'];
  }

}
