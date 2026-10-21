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
use Drupal\user\UserInterface;

/**
 * An account was made the assignee of a ticket, on create or on update.
 *
 * Also covers the assignee derived from the conductor's owner: it is set
 * before the save, so the saved ticket already holds it. The same assignee
 * again, a cleared assignee and account zero record nothing.
 */
#[BbActivityKind(
  id: Assigned::ID,
  label: new TranslatableMarkup('Assigned'),
  weight: 35,
  triggers: ['bb_ticket:insert', 'bb_ticket:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
    'original' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Stored ticket'), required: FALSE),
  ],
  mail: TRUE,
  mail_label: new TranslatableMarkup('Ticket assigned'),
  mail_description: new TranslatableMarkup('A ticket is assigned to you.'),
)]
final class Assigned extends ActivityKindBase {

  public const ID = 'assigned';

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    $ticket = $this->contextEntity();
    $original = $this->getContextValue('original');
    $uid = (int) $ticket->get('assignee_user_id')->target_id;
    if ($uid <= 0 || ($original instanceof BbTicketInterface && $uid === (int) $original->get('assignee_user_id')->target_id)) {
      return NULL;
    }
    // A dangling account ID is no assignment.
    if (!$ticket->get('assignee_user_id')->entity instanceof UserInterface) {
      return NULL;
    }
    return $this->save($ticket, ['accounts' => [$uid]]);
  }

  /**
   * {@inheritdoc}
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    $names = $this->accountNames($activity, $reader);
    return [
      new FeedMessage('assigned', 'assigned' . ($names !== [] ? ' to ' . implode(', ', $names) : ''), role: 'human'),
      new MailMessage($this->t('You were assigned to this ticket', [], ['langcode' => $langcode])),
    ];
  }

}
