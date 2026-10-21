<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger_test\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\State\StateInterface;

/**
 * Fails ticket saves, or one trigger's saves, while a state flag is set.
 */
final class TicketSaveFailureHooks {

  /**
   * The state key that switches the failure on.
   */
  public const STATE_KEY = 'bb_ticket_trigger_test.fail_ticket_save';

  /**
   * The state key holding the ID of the trigger whose saves fail.
   */
  public const TRIGGER_STATE_KEY = 'bb_ticket_trigger_test.fail_trigger_save';

  public function __construct(
    private readonly StateInterface $state,
  ) {}

  /**
   * Throws like a storage outage.
   */
  #[Hook('bb_ticket_presave')]
  public function ticketPresave(): void {
    if ($this->state->get(self::STATE_KEY, FALSE)) {
      throw new \RuntimeException('Simulated storage outage.');
    }
  }

  /**
   * Throws like a deadlock while recording one trigger's outcome.
   */
  #[Hook('bb_ticket_trigger_presave')]
  public function triggerPresave(EntityInterface $trigger): void {
    $failing = $this->state->get(self::TRIGGER_STATE_KEY);
    if ($failing !== NULL && (string) $failing === (string) $trigger->id()) {
      throw new \RuntimeException('Simulated deadlock.');
    }
  }

}
