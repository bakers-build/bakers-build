<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates that no ticket of another project carries the prefix.
 */
final class BbProjectKeyReservedConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs the validator.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager used to query tickets.
   */
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
    assert($constraint instanceof BbProjectKeyReservedConstraint);
    $key = (string) $items->value;
    if ($key === '') {
      return;
    }
    $entity = $items->getEntity();
    // Reservation is global, so it must see tickets the editor cannot read;
    // the message names no project.
    $query = $this->entityTypeManager->getStorage('bb_ticket')->getQuery()
      ->accessCheck(FALSE)
      ->condition('identifier', $key . '-', 'STARTS_WITH')
      ->range(0, 1);
    if (!$entity->isNew()) {
      $query->condition('project_id', $entity->id(), '<>');
    }
    if ($query->execute() !== []) {
      $this->context->addViolation($constraint->message, ['%value' => $key]);
    }
  }

}
