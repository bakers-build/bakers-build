<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Workflow\ReviewTransitionHandler;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates BbReviewCommentConstraint.
 */
final class BbReviewCommentConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  public function __construct(
    private readonly ReviewTransitionHandler $handler,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get(ReviewTransitionHandler::class));
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    if (!$value instanceof BbCommentInterface) {
      return;
    }
    foreach ($this->handler->violations($value) as $message) {
      $this->context->addViolation($message);
    }
  }

}
