<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\Validation\Constraint;

use Drupal\Core\Field\FieldItemListInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\user\UserInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates BbTicketTriggerActorConstraint.
 *
 * Reads the `bb_service_workspace` marker by name: bb_api_key declares
 * it, and without that module no account qualifies.
 */
final class BbTicketTriggerActorConstraintValidator extends ConstraintValidator {

  /**
   * The service-account marker field on `user`.
   */
  private const MARKER_FIELD = 'bb_service_workspace';

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof BbTicketTriggerActorConstraint);
    if (!$items instanceof FieldItemListInterface || $items->isEmpty()) {
      return;
    }
    $trigger = $items->getEntity();
    $workspace = $trigger instanceof BbTicketTriggerInterface ? $trigger->getWorkspace() : NULL;
    $actor = $items->first()?->get('entity')->getValue();
    if (!self::isActiveServiceAccountOf($actor, $workspace)) {
      $this->context->addViolation($constraint->message);
    }
  }

  /**
   * Whether $actor is an active service account of $workspace.
   *
   * Shared with TicketTriggerRunner, which re-checks it on every run.
   */
  public static function isActiveServiceAccountOf(mixed $actor, ?BbWorkspaceInterface $workspace): bool {
    return $workspace !== NULL
      && $actor instanceof UserInterface
      && $actor->isActive()
      && $actor->hasField(self::MARKER_FIELD)
      && (int) $actor->get(self::MARKER_FIELD)->target_id === (int) $workspace->id();
  }

}
