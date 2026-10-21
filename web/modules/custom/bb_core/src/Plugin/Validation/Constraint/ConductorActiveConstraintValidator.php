<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates that a ticket is not newly assigned to an inactive conductor.
 */
final class ConductorActiveConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('entity_type.manager'));
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    if (!$constraint instanceof ConductorActiveConstraint) {
      return;
    }
    if (!$value instanceof FieldItemListInterface || $value->isEmpty()) {
      return;
    }
    $conductor = $value->entity;
    if (!$conductor instanceof BbConductorInterface || (bool) $conductor->get('active')->value) {
      return;
    }
    $ticket = $value->getEntity();
    if (!$ticket instanceof BbTicketInterface) {
      return;
    }
    $previous = $this->previousConductorId($ticket);
    if ($previous !== NULL && (string) $previous === (string) $conductor->id()) {
      return;
    }
    $this->context->addViolation($constraint->message, ['@label' => $conductor->label()]);
  }

  /**
   * The conductor id the ticket carried before this write, if any.
   *
   * `getOriginal()` is populated only during a save cycle and is NULL for
   * validation calls outside one (e.g. ContentEntityForm, JSON:API), so the
   * stored entity is the only reliable source of the previous reference.
   */
  private function previousConductorId(BbTicketInterface $ticket): string|null {
    $original = $ticket->getOriginal();
    if (!$original instanceof BbTicketInterface) {
      $original = $ticket->isNew() ? NULL : $this->entityTypeManager->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    }
    return $original instanceof BbTicketInterface ? $original->get('conductor_id')->target_id : NULL;
  }

}
