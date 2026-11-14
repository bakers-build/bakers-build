<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the board column classification for a ticket.
 */
final class WorkStateItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function ensureComputedValue(): void {
    $this->computeValue();
    $this->valueComputed = TRUE;
  }

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $entity = $this->getEntity();
    if (!$entity instanceof BbTicketInterface) {
      return;
    }
    $this->list[0] = $this->createItem(0, $this->workState($entity));
  }

  /**
   * Rule order: closed, no conductor, qualification, blocked without a run.
   *
   * The blocker and live-run lookups only run for an assigned ticket past
   * qualification, so unblocked tickets add no run query.
   */
  private function workState(BbTicketInterface $ticket): string {
    if ($ticket->get('closed')->value) {
      return 'done';
    }
    if ($ticket->get('conductor_id')->isEmpty()) {
      return 'not_assigned';
    }
    if ($ticket->get('state')->value === 'qualification') {
      return 'intake';
    }
    $blockedIdle = $ticket->hasOpenBlockers()
      && !\Drupal::service('bb_core.ticket_run_deriver')->hasLiveRun($ticket);
    return $blockedIdle ? 'intake' : 'working';
  }

}
