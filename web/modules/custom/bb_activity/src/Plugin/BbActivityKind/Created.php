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

/**
 * A ticket was created, with its workflow and first state.
 */
#[BbActivityKind(
  id: Created::ID,
  label: new TranslatableMarkup('Created'),
  weight: 0,
  triggers: ['bb_ticket:insert'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
  ],
)]
final class Created extends ActivityKindBase {

  public const ID = 'created';

  /**
   * {@inheritdoc}
   */
  public function record(): BbActivity {
    $ticket = $this->contextEntity();
    return $this->save($ticket, ['new_state' => (string) $ticket->get('state')->value]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    $about = implode(', ', array_filter([
      (string) preg_replace('/^bb_/', '', (string) ($activity->get('workflow')->value ?? '')),
      (string) ($activity->get('new_state')->value ?? ''),
    ]));
    return [new FeedMessage('created', 'created' . ($about !== '' ? ' (' . $about . ')' : ''))];
  }

}
