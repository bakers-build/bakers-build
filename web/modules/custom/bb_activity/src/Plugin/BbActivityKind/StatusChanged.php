<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\BbActivityKind;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\ActivityKindBase;
use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Attribute\BbActivityKind;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * A ticket changed state, with the run it closed and that step's summary.
 *
 * A save that keeps the state records nothing.
 */
#[BbActivityKind(
  id: StatusChanged::ID,
  label: new TranslatableMarkup('Status changed'),
  weight: 10,
  triggers: ['bb_ticket:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
    'original' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Stored ticket')),
  ],
)]
final class StatusChanged extends ActivityKindBase {

  public const ID = 'status_changed';

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    $ticket = $this->contextEntity();
    $original = $this->getContextValue('original');
    assert($original instanceof BbTicketInterface);
    $previous = (string) $original->get('state')->value;
    if ($previous === (string) $ticket->get('state')->value) {
      return NULL;
    }
    $values = [
      'previous_state' => $previous,
      'new_state' => (string) $ticket->get('state')->value,
      'comment_id' => $this->stepSummaryId($ticket),
    ];
    $run = $this->closedRun($ticket, $previous);
    if ($run !== NULL) {
      $values['run_id'] = $run->id();
      $values['conductor_id'] = $run->get('conductor_id')->target_id;
    }
    return $this->save($ticket, $values);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    return [
      new FeedMessage(
        'status',
        (string) ($activity->get('previous_state')->value ?? '') . ' → ' . (string) ($activity->get('new_state')->value ?? ''),
        role: 'human',
        duration: TRUE,
      ),
    ];
  }

  /**
   * The newest run that started in the previous state and this save closes.
   *
   * The state machine closes that run while the save is still running, before
   * the activity is recorded: a run counts when it is still active or was
   * closed by this very save, which stamps run and ticket with one time.
   */
  private function closedRun(BbTicketInterface $ticket, string $previous): ?BbRunInterface {
    $storage = $this->entityTypeManager->getStorage('bb_run');
    $query = $storage->getQuery()->accessCheck(FALSE);
    $query->condition('ticket_id', $ticket->id())->condition('state_at_start', $previous);
    $query->condition($query->orConditionGroup()
      ->condition('state', ['claimed', 'running'], 'IN')
      ->condition($query->andConditionGroup()
        ->condition('state', 'done')
        ->condition('changed', (int) $ticket->get('changed')->value, '>=')));
    $ids = $query->sort('id', 'DESC')->range(0, 1)->execute();
    $run = $ids === [] ? NULL : $storage->load(reset($ids));
    return $run instanceof BbRunInterface ? $run : NULL;
  }

  /**
   * The newest summary published since the ticket entered its current state.
   *
   * The entry time is the newest created or status row of the ticket, else
   * the ticket's own creation.
   */
  private function stepSummaryId(BbTicketInterface $ticket): ?string {
    $activities = $this->entityTypeManager->getStorage('bb_activity');
    $entered = $activities->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('kind', [Created::ID, self::ID], 'IN')
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $row = $entered === [] ? NULL : $activities->load(reset($entered));
    $since = $row instanceof BbActivity
      ? (int) $row->getCreatedTime()
      : (int) $ticket->get('created')->value;
    $query = $this->entityTypeManager->getStorage('bb_comment')->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('type', 'summary')
      ->condition('status', 1)
      ->condition('created', $since, '>=')
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1);
    // Timestamps are whole seconds: the summary the entry row linked may share
    // its second and belongs to the previous state.
    $linked = $row instanceof BbActivity ? $row->get('comment_id')->target_id : NULL;
    if ($linked !== NULL) {
      $query->condition('id', $linked, '<>');
    }
    $ids = $query->execute();
    return $ids === [] ? NULL : (string) reset($ids);
  }

}
