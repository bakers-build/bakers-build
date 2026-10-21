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
 * Validates the ticket parent_id graph for acyclicity.
 *
 * `parent_id` is single-valued, so the walk is a simple ancestor chain
 * rather than `BlockedByAcyclicConstraintValidator`'s breadth-first search
 * over several deltas; otherwise the same shape.
 */
final class ParentAcyclicConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

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
    assert($constraint instanceof ParentAcyclicConstraint);
    if (!$items instanceof FieldItemListInterface || $items->isEmpty()) {
      return;
    }
    $ticket = $items->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->id() === NULL) {
      return;
    }
    $self = (int) $ticket->id();
    $target_id = $items->first()?->getValue()['target_id'] ?? NULL;
    if (!is_numeric($target_id)) {
      return;
    }
    if ($this->pathReachesTicket((int) $target_id, $self)) {
      $this->context->buildViolation($constraint->message)
        ->setParameter('%parent', (string) $target_id)
        ->addViolation();
    }
  }

  /**
   * Checks whether walking parent_id from $start_id can reach $ticket_id.
   */
  private function pathReachesTicket(int $start_id, int $ticket_id): bool {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $current = $start_id;
    $visited = [];
    while ($current !== NULL) {
      if ($current === $ticket_id) {
        return TRUE;
      }
      if (isset($visited[$current])) {
        // Already a cycle among OTHER tickets; not this save's doing.
        return FALSE;
      }
      $visited[$current] = TRUE;
      $ticket = $storage->load($current);
      $current = $ticket instanceof BbTicketInterface ? $ticket->getParentId() : NULL;
    }
    return FALSE;
  }

}
