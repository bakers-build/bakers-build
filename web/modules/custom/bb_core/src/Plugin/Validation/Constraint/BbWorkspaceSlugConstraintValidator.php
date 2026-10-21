<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates a bb_workspace slug — pattern, uniqueness, reserved words.
 */
final class BbWorkspaceSlugConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs the validator.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager used to look for a workspace with the same slug.
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
    assert($constraint instanceof BbWorkspaceSlugConstraint);
    $entity = $items->getEntity();
    if (!$entity instanceof BbWorkspaceInterface) {
      return;
    }
    $slug = (string) $items->value;
    if ($slug === '') {
      // An empty slug is the required constraint's business, not ours; saying
      // it twice would put two violations on one field.
      return;
    }

    if (preg_match(BbWorkspaceSlugConstraint::PATTERN, $slug) !== 1) {
      $this->context->addViolation($constraint->patternMessage, ['%slug' => $slug]);
      // The remaining two rules read the value as a path segment, which it
      // demonstrably is not — reporting them as well would only add noise.
      return;
    }

    if (in_array($slug, BbWorkspaceSlugConstraint::RESERVED, TRUE)) {
      $this->context->addViolation($constraint->reservedMessage, ['%slug' => $slug]);
      return;
    }

    $query = $this->entityTypeManager->getStorage('bb_workspace')->getQuery()
      ->accessCheck(FALSE)
      ->condition('slug', $slug)
      ->range(0, 1);
    if (!$entity->isNew()) {
      $query->condition('id', $entity->id(), '<>');
    }
    if ($query->execute() !== []) {
      $this->context->addViolation($constraint->uniqueMessage, ['%slug' => $slug]);
    }
  }

}
