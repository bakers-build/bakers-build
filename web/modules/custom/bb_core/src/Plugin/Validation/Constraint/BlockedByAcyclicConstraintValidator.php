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
 * Validates the ticket blocked_by graph for acyclicity.
 *
 * For every incoming blocked_by reference the validator performs a breadth-
 * first traversal of the blocker's own blocked_by sub-graph. If the traversal
 * reaches the ticket being saved, adding that reference would close a cycle
 * and a constraint violation is recorded at the offending delta.
 */
final class BlockedByAcyclicConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs a BlockedByAcyclicConstraintValidator.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager used to load ticket entities during traversal.
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
    assert($constraint instanceof BlockedByAcyclicConstraint);
    if (!$items instanceof FieldItemListInterface || $items->isEmpty()) {
      return;
    }
    $ticket = $items->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->id() === NULL) {
      return;
    }
    $self = (int) $ticket->id();
    foreach ($this->blockedByTargets($items) as $delta => $target_id) {
      if ($this->pathReachesTicket($target_id, $self)) {
        $this->context->buildViolation($constraint->message)
          ->setParameter('%blocker', (string) $target_id)
          ->atPath((string) $delta)
          ->addViolation();
      }
    }
  }

  /**
   * Returns a map of delta => target entity ID from the given field item list.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The blocked_by field items to inspect.
   *
   * @return array<int, int>
   *   Keyed by delta, values are numeric target entity IDs.
   */
  private function blockedByTargets(FieldItemListInterface $items): array {
    $targets = [];
    foreach ($items as $delta => $item) {
      $target_id = $item->getValue()['target_id'] ?? NULL;
      if (is_numeric($target_id)) {
        $targets[(int) $delta] = (int) $target_id;
      }
    }
    return $targets;
  }

  /**
   * Checks whether a breadth-first walk from $start_id can reach $ticket_id.
   *
   * @param int $start_id
   *   The entity ID of the ticket to start traversal from.
   * @param int $ticket_id
   *   The entity ID to search for in the blocker sub-graph.
   *
   * @return bool
   *   TRUE if $ticket_id is reachable from $start_id, FALSE otherwise.
   */
  private function pathReachesTicket(int $start_id, int $ticket_id): bool {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $queue = [$start_id];
    $visited = [];
    while ($queue !== []) {
      $current = array_shift($queue);
      if ($current === $ticket_id) {
        return TRUE;
      }
      if (isset($visited[$current])) {
        continue;
      }
      $visited[$current] = TRUE;
      $blocker = $storage->load($current);
      if ($blocker instanceof BbTicketInterface) {
        $queue = array_merge($queue, $blocker->getBlockedByIds());
      }
    }
    return FALSE;
  }

}
