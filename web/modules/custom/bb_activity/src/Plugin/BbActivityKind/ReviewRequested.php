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
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Accounts were added to a ticket's Reviewers, on create or on update.
 *
 * One row per save lists every account added by it; removals record nothing.
 */
#[BbActivityKind(
  id: ReviewRequested::ID,
  label: new TranslatableMarkup('Review requested'),
  weight: 40,
  triggers: ['bb_ticket:insert', 'bb_ticket:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
    'original' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Stored ticket'), required: FALSE),
  ],
  mail: TRUE,
  mail_label: new TranslatableMarkup('Review requested'),
  mail_description: new TranslatableMarkup('Someone asks you for a review.'),
)]
final class ReviewRequested extends ActivityKindBase {

  public const ID = 'review_requested';

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    $ticket = $this->contextEntity();
    $original = $this->getContextValue('original');
    // An insert has no stored predecessor: every reviewer is new.
    $added = $original instanceof BbTicketInterface
      ? array_values(array_diff(self::reviewers($ticket), self::reviewers($original)))
      : self::reviewers($ticket);
    return $added === [] ? NULL : $this->save($ticket, ['accounts' => $added]);
  }

  /**
   * {@inheritdoc}
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    $names = $this->accountNames($activity, $reader);
    return [
      new FeedMessage('review', 'requested a review' . ($names !== [] ? ' from ' . implode(', ', $names) : ''), role: 'human'),
      new MailMessage($this->t('Your review was requested', [], ['langcode' => $langcode])),
    ];
  }

  /**
   * A ticket's reviewers, uid 0 excluded.
   *
   * @return list<int>
   *   Account IDs, in stored order.
   */
  private static function reviewers(BbTicketInterface $ticket): array {
    $uids = array_map(static fn (array $item): int => (int) ($item['target_id'] ?? 0), $ticket->get('reviewers')->getValue());
    return array_values(array_unique(array_filter($uids, static fn (int $uid): bool => $uid > 0)));
  }

}
