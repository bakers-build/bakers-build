<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\bb_core\Entity\BbTermInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates that a term name is unique within (workspace_id, vid).
 *
 * The scope-blind lookup is deliberate: with accessCheck(FALSE) a uniqueness
 * check bounded by the acting
 * account's read scope would answer "unique" for a name the account cannot see,
 * and the write would then fail — or succeed — for a reason no message
 * explains. The message therefore discloses nothing but the name (see the
 * constraint).
 */
final class BbTermUniqueNameInWorkspaceConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs the validator.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager used to query sibling terms.
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
    assert($constraint instanceof BbTermUniqueNameInWorkspaceConstraint);
    if (!$items instanceof FieldItemListInterface) {
      return;
    }
    $entity = $items->getEntity();
    if (!$entity instanceof BbTermInterface) {
      return;
    }
    $name = (string) $items->value;
    if ($name === '') {
      return;
    }
    // Emptiness is the required field's own business. It also matters
    // operationally: between the storage install and the backfill every row has
    // an empty workspace_id, and treating NULL as a scope would report all of
    // them as colliding with each other.
    $workspace_id = $entity->get('workspace_id')->target_id;
    if ($workspace_id === NULL || $workspace_id === '') {
      return;
    }

    $query = $this->entityTypeManager->getStorage('bb_term')->getQuery()
      ->accessCheck(FALSE)
      ->condition('name', $name)
      ->condition('workspace_id', $workspace_id)
      ->condition('vid', $entity->bundle())
      ->range(0, 1);
    if (!$entity->isNew()) {
      $query->condition('id', $entity->id(), '<>');
    }
    if ($query->execute() !== []) {
      $this->context->addViolation($constraint->message, ['%name' => $name]);
    }
  }

}
