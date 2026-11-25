<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes why a ticket needs a person: question, plan_ready, review or ''.
 */
final class AttentionItemList extends FieldItemList {

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
    $this->list[0] = $this->createItem(0, $this->attention($entity));
  }

  /**
   * Rule order: closed, frozen with Question, a plan to read, review.
   *
   * The comment and run lookups only run for a ticket in plan.
   */
  private function attention(BbTicketInterface $ticket): string {
    if ($ticket->get('closed')->value) {
      return '';
    }
    if ($ticket->isFrozen() && $this->hasQuestionLabel($ticket)) {
      return 'question';
    }
    $state = $ticket->get('state')->value;
    if ($state === 'plan' && $this->hasPlanAndNoOpenRun($ticket)) {
      return 'plan_ready';
    }
    return $state === 'review' ? 'review' : '';
  }

  /**
   * Whether a label named Question, in any letter case, is on the ticket.
   */
  private function hasQuestionLabel(BbTicketInterface $ticket): bool {
    foreach ($ticket->get('labels')->referencedEntities() as $label) {
      if (mb_strtolower((string) $label->label()) === 'question') {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Whether a plan comment exists and no run is claimed or running.
   */
  private function hasPlanAndNoOpenRun(BbTicketInterface $ticket): bool {
    $etm = \Drupal::entityTypeManager();
    $plans = $etm->getStorage('bb_comment')->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('type', 'plan')
      ->count()
      ->execute();
    if (!$plans) {
      return FALSE;
    }
    $openRuns = $etm->getStorage('bb_run')->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('state', ['claimed', 'running'], 'IN')
      ->count()
      ->execute();
    return !$openRuns;
  }

}
