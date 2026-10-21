<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Terminal-run safety net: retire the last run when a ticket reaches done.
 *
 * TicketTransitionSubscriber only fires when the state machine resolves a
 * transition; a raw terminal `state` write via an undefined edge dispatches
 * no event and would leave the last run claimed forever. So every update that
 * enters a terminal state calls closeRunsForState directly; it is idempotent
 * with the subscriber.
 */
final class TicketRunClosureHooks {

  public function __construct(
    #[Autowire(service: 'bb_core.ticket_claim')]
    private readonly TicketClaimService $ticketClaim,
  ) {
  }

  /**
   * Implements hook_entity_update().
   *
   * Closes the ticket's last still-active run when it enters a terminal state,
   * regardless of whether a state-machine transition event fired. Core
   * invokes it after every hook_ENTITY_TYPE_update(), so those still see the
   * run the state change closes.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The updated ticket entity.
   */
  #[Hook('entity_update')]
  public function ticketUpdate(EntityInterface $entity): void {
    if (!$entity instanceof BbTicketInterface) {
      return;
    }
    $workflow = $entity->getWorkflow();
    if ($workflow === '') {
      return;
    }
    $state = (string) $entity->get('state')->value;
    $original = $entity->getOriginal();
    $previous = $original instanceof BbTicketInterface
      ? (string) $original->get('state')->value
      : '';
    if ($state === $previous || !TypeWorkflows::isTerminal($workflow, $state)) {
      return;
    }
    $this->ticketClaim->closeRunsForState($entity);
  }

}
