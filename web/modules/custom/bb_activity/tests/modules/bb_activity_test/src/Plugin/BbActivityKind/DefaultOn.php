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
 * A kind deployed later: this class and one causer call.
 */
#[BbActivityKind(
  id: 'test_default_on',
  label: new TranslatableMarkup('Test default on'),
  weight: 100,
  triggers: ['bb_ticket:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
    'original' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Stored ticket')),
  ],
  mail: TRUE,
  mail_default: TRUE,
)]
final class DefaultOn extends ActivityKindBase {

  use EveryAccountRecipients;

  /**
   * The state that switches recording on.
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
    return $this->state->get('bb_activity_test.record', FALSE)
      ? $this->save($ticket, [])
      : NULL;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    return [
      new FeedMessage('test', 'did a test thing'),
      new MailMessage($this->t('A test activity happened', [], ['langcode' => $langcode])),
    ];
  }

}
