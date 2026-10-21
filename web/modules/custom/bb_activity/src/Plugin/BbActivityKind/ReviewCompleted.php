<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\BbActivityKind;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\ActivityKindBase;
use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Activity\MailMessage;
use Drupal\bb_activity\Attribute\BbActivityKind;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * A reviewer submitted their review (draft to submitted).
 *
 * The row is addressed to the requester: the actor of the newest
 * review_requested row that named this reviewer, else the ticket's assignee.
 */
#[BbActivityKind(
  id: ReviewCompleted::ID,
  label: new TranslatableMarkup('Review completed'),
  weight: 50,
  triggers: ['bb_comment:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_comment', new TranslatableMarkup('Comment')),
    'original' => new EntityContextDefinition('entity:bb_comment', new TranslatableMarkup('Stored comment')),
  ],
  mail: TRUE,
  mail_label: new TranslatableMarkup('Review completed'),
  mail_description: new TranslatableMarkup('A review you asked for is submitted.'),
)]
final class ReviewCompleted extends ActivityKindBase {

  public const ID = 'review_completed';

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    $review = $this->getContextValue('entity');
    $original = $this->getContextValue('original');
    assert($review instanceof BbCommentInterface && $original instanceof BbCommentInterface);
    // Reviews are created as drafts, so only an update reaches submitted.
    if ($review->bundle() !== 'review'
      || (string) $original->get('review_state')->value !== 'draft'
      || (string) $review->get('review_state')->value !== 'submitted') {
      return NULL;
    }
    $ticket = $review->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface) {
      return NULL;
    }
    $requester = $this->requester($ticket, $review);
    return $this->save($ticket, [
      'comment_id' => $review->id(),
      'accounts' => $requester > 0 ? [$requester] : [],
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    $options = ['langcode' => $langcode];
    return [
      new FeedMessage('review', 'completed a review', role: 'human', commentLink: (string) $this->t('Review', [], $options)),
      new MailMessage($this->t('A review was submitted', [], $options)),
    ];
  }

  /**
   * Who asked this reviewer for the review; 0 when nobody can be named.
   */
  private function requester(BbTicketInterface $ticket, BbCommentInterface $review): int {
    $storage = $this->entityTypeManager->getStorage('bb_activity');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('kind', ReviewRequested::ID)
      ->condition('accounts', (int) $review->getOwnerId())
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $row = $ids === [] ? NULL : $storage->load(reset($ids));
    $actor = $row instanceof BbActivity ? (int) $row->get('actor')->target_id : 0;
    return $actor > 0 ? $actor : (int) $ticket->get('assignee_user_id')->target_id;
  }

}
