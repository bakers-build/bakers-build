<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger_test\Plugin\BbTicketTriggerTarget;

use Drupal\Core\Session\AccountInterface;
use Drupal\Core\State\StateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_ticket_trigger\Attribute\BbTicketTriggerTarget;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerTargetBase;
use Drupal\bb_ticket_trigger\TicketTrigger\TriggerActionResult;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A fixture target that acts on a ticket without creating one.
 *
 * Each action is recorded in state; a state switch makes it fail
 * transiently (\RuntimeException) or permanently (\LogicException).
 */
#[BbTicketTriggerTarget(
  id: 'test_ticket',
  label: new TranslatableMarkup('Test ticket'),
  target_entity_type: 'bb_ticket',
  target_field: 'test_ticket_id',
)]
final class TestTicket extends TicketTriggerTargetBase {

  /**
   * The state key listing every action as [ticket ID, actor ID].
   */
  public const ACTED = 'bb_ticket_trigger_test.acted';

  /**
   * The state key switching failures on: 'transient' or 'permanent'.
   */
  public const FAIL = 'bb_ticket_trigger_test.fail';

  /**
   * The state the actions and switches live in.
   */
  private StateInterface $state;

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param array<string, mixed> $plugin_definition
   *   The plugin definition.
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->state = $container->get('state');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function preflight(BbTicketTriggerInterface $trigger, AccountInterface $actor): ?string {
    $ticket = $this->getTarget($trigger);
    return $ticket !== NULL && $ticket->access('update', $actor) ? NULL : 'The account may not update the ticket.';
  }

  /**
   * {@inheritdoc}
   */
  public function execute(BbTicketTriggerInterface $trigger, AccountInterface $actor): TriggerActionResult {
    $failure = $this->state->get(self::FAIL);
    if ($failure === 'transient') {
      throw new \RuntimeException('Simulated outage.');
    }
    if ($failure === 'permanent') {
      throw new \LogicException('Simulated permanent failure.');
    }
    $ticket = $this->getTarget($trigger);
    assert($ticket instanceof BbTicketInterface);
    $this->state->set(self::ACTED, [...$this->state->get(self::ACTED, []), [(int) $ticket->id(), (int) $actor->id()]]);
    return new TriggerActionResult(sprintf('Acted on %s.', $ticket->getIdentifier()), $ticket);
  }

  /**
   * {@inheritdoc}
   */
  public function isPermanentFailure(\Throwable $e): bool {
    return $e instanceof \LogicException;
  }

  /**
   * {@inheritdoc}
   */
  public function listUrl(BbTicketTriggerInterface $trigger): ?Url {
    return NULL;
  }

}
