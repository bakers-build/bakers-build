<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the branch a ticket's work merges into.
 *
 * A deployment ticket with exactly one environment merges into that
 * environment's branch; every other ticket into its base_branch. Read-only:
 * ticket_type, environments and base_branch remain the source of truth.
 */
final class TargetBranchItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface) {
      return;
    }
    $this->list[0] = $this->createItem(0, ['value' => $this->resolve($ticket)]);
  }

  /**
   * Resolves the target branch for a ticket.
   */
  private function resolve(BbTicketInterface $ticket): string {
    $base = (string) $ticket->get('base_branch')->value;
    if (mb_strtolower((string) $ticket->get('ticket_type')->entity?->label()) !== 'deployment') {
      return $base;
    }
    $environments = $ticket->get('environments')->referencedEntities();
    $only = count($environments) === 1 ? $environments[0] : NULL;
    return ($only instanceof BbEnvironmentInterface ? $only->getBranch() : NULL) ?? $base;
  }

}
