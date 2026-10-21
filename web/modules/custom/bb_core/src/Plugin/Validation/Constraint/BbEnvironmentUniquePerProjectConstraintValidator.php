<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates that an environment name is unique within its project.
 */
final class BbEnvironmentUniquePerProjectConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs the validator.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager used to query sibling environments.
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
    assert($constraint instanceof BbEnvironmentUniquePerProjectConstraint);
    $entity = $items->getEntity();
    if (!$entity instanceof BbEnvironmentInterface) {
      return;
    }
    $name = (string) $items->value;
    if ($name === '') {
      return;
    }
    $project_id = $entity->get('project_id')->target_id;
    if ($project_id === NULL || $project_id === '') {
      return;
    }

    $query = $this->entityTypeManager->getStorage('bb_environment')->getQuery()
      ->accessCheck(FALSE)
      ->condition('name', $name)
      ->condition('project_id', $project_id)
      ->range(0, 1);
    if (!$entity->isNew()) {
      $query->condition('id', $entity->id(), '<>');
    }
    if ($query->execute() !== []) {
      $this->context->addViolation($constraint->message, ['%name' => $name]);
    }
  }

}
