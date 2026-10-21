<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates the BbParentSameProject constraint.
 */
final class ParentSameProjectConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

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
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof ParentSameProjectConstraint);
    assert($items instanceof FieldItemListInterface);
    $ticket = $items->getEntity();
    // A ticket without a project has nothing to compare; project_id's own
    // validation owns that case.
    if ($items->isEmpty() || !$ticket instanceof BbTicketInterface || $ticket->get('project_id')->isEmpty()) {
      return;
    }
    $parentId = (string) $items->first()?->getValue()['target_id'];
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $stored = $ticket->isNew() ? NULL : $storage->loadUnchanged($ticket->id());
    if ($stored instanceof BbTicketInterface && (string) $stored->getParentId() === $parentId) {
      return;
    }
    // Access-unchecked on purpose: the project of a parent the writer cannot
    // read is still compared; ValidReference owns the access question.
    $parent = $storage->load($parentId);
    if ($parent instanceof BbTicketInterface && $parent->get('project_id')->target_id != $ticket->get('project_id')->target_id) {
      $this->context->addViolation($constraint->message);
    }
  }

}
