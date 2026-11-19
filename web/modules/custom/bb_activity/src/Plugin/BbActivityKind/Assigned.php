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
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * An account was made the assignee of a ticket, on create or on update.
 *
 * Also covers the assignee derived from the conductor's owner: it is set
 * before the save, so the saved ticket already holds it. The same assignee
 * again, a cleared assignee and account zero record nothing. The account that
 * saved the ticket is never mailed about its own assignment.
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
   * Whom a reader may be told about.
   */
  protected BbWorkspaceReadScopeInterface $readScope;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->readScope = $container->get('bb_core.workspace_read_scope');
    return $instance;
  }

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
  public function recipients(BbActivity $activity): array {
    $actor = (int) $activity->get('actor')->target_id;
    return array_values(array_diff(parent::recipients($activity), [$actor]));
  }

  /**
   * {@inheritdoc}
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    $names = $this->accountNames($activity, $reader);
    return [
      new FeedMessage('assigned', 'assigned' . ($names !== [] ? ' to ' . implode(', ', $names) : ''), role: 'human'),
      new MailMessage($this->mailLine($activity, $reader, $langcode)),
    ];
  }

  /**
   * Who assigned the reader and who created the ticket, each named once.
   */
  private function mailLine(BbActivity $activity, AccountInterface $reader, string $langcode): TranslatableMarkup {
    $options = ['langcode' => $langcode];
    $actor = $activity->get('actor')->entity;
    $ticket = $activity->get('ticket_id')->entity;
    $creator = $ticket instanceof BbTicketInterface ? $ticket->get('owner_user_id')->entity : NULL;
    $actor_id = $actor instanceof UserInterface ? (int) $actor->id() : 0;
    $creator_id = $creator instanceof UserInterface ? (int) $creator->id() : 0;
    $args = ['@assigner' => $this->nameFor($actor, $reader, $langcode)];
    if ($creator_id > 0 && $creator_id === (int) $reader->id()) {
      return $this->t('@assigner assigned you to your ticket', $args, $options);
    }
    if ($creator_id > 0 && $creator_id === $actor_id) {
      return $this->t('@assigner assigned you to their ticket', $args, $options);
    }
    return $this->t('@assigner assigned you to this ticket, created by @creator', $args + ['@creator' => $this->nameFor($creator, $reader, $langcode)], $options);
  }

  /**
   * An account's name if the reader may be told it.
   *
   * The read scope, not entity access: core allows every user's `view label`
   * and no role holds `access user profiles`, which `view` needs.
   */
  private function nameFor(mixed $account, AccountInterface $reader, string $langcode): string {
    if (!$account instanceof UserInterface || $account->isAnonymous()) {
      return 'bakers.build';
    }
    return in_array((int) $account->id(), $this->readScope->peopleIds($reader), TRUE)
      ? $this->personDisplayName($account)
      : (string) $this->t('Someone', [], ['langcode' => $langcode]);
  }

}
