<?php

declare(strict_types=1);

namespace Drupal\bb_activity_test\Plugin\BbActivityKind;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\State\StateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\ActivityKindBase;
use Drupal\bb_activity\Attribute\BbActivityKind;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_activity_test\EveryAccountRecipients;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Records fine, then fails while its mail is built.
 */
#[BbActivityKind(
  id: 'test_broken',
  label: new TranslatableMarkup('Test broken'),
  weight: -10,
  triggers: ['bb_ticket:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
    'original' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Stored ticket')),
  ],
  mail: TRUE,
)]
final class Broken extends ActivityKindBase {

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
    return $this->state->get('bb_activity_test.break', FALSE)
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
    throw new \LogicException('Broken on purpose.');
  }

}
