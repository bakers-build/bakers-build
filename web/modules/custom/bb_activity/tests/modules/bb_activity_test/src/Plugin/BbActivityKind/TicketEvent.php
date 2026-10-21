<?php

declare(strict_types=1);

namespace Drupal\bb_activity_test\Plugin\BbActivityKind;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\State\StateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\ActivityKindBase;
use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Activity\MailMessage;
use Drupal\bb_activity\Attribute\BbActivityKind;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_activity_test\EveryAccountRecipients;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A ticket kind mailed to every account that ticked it and may view it.
 *
 * It stands in for the shipped ticket kinds, which offer no mail for now, so
 * the mailer's own rules stay covered. While the state flag
 * bb_activity_test.feed_only is set it words no mail.
 */
#[BbActivityKind(
  id: 'test_ticket_event',
  label: new TranslatableMarkup('Test ticket event'),
  weight: 110,
  triggers: ['bb_ticket:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
    'original' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Stored ticket')),
  ],
  mail: TRUE,
)]
final class TicketEvent extends ActivityKindBase {

  use EveryAccountRecipients;

  /**
   * The state that switches the mail text off.
   */
  private StateInterface $state;

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The service container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param mixed $plugin_definition
   *   The plugin definition.
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $plugin = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $plugin->state = $container->get('state');
    return $plugin;
  }

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    $ticket = $this->contextEntity();
    $original = $this->getContextValue('original');
    assert($original instanceof BbTicketInterface);
    return $this->state->get('bb_activity_test.ticket_event', FALSE)
      && $original->get('state')->value !== $ticket->get('state')->value
      ? $this->save($ticket, [])
      : NULL;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    $feed = new FeedMessage('test', 'had a ticket event');
    if ($this->state->get('bb_activity_test.feed_only', FALSE)) {
      return [$feed];
    }
    return [$feed, new MailMessage($this->t('A test ticket event happened', [], ['langcode' => $langcode]))];
  }

}
