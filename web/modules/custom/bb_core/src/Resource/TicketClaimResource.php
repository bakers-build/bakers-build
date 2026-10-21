<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Claims a specific ticket via JSON:API action.
 */
final class TicketClaimResource extends EntityResourceBase implements ContainerInjectionInterface {

  use ConductorResolverTrait;

  /**
   * Constructs a TicketClaimResource.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param \Drupal\Core\Session\AccountInterface $current_user
   *   The current user account.
   * @param \Drupal\bb_core\Claim\TicketClaimService $ticketClaim
   *   The ticket claim service used to create a run for the given ticket.
   */
  public function __construct(
    EntityTypeManagerInterface $entity_type_manager,
    AccountInterface $current_user,
    private readonly TicketClaimService $ticketClaim,
  ) {
    $this->entityTypeManager = $entity_type_manager;
    $this->currentUser = $current_user;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('bb_core.ticket_claim'),
    );
  }

  /**
   * Handles the ticket-specific claim POST request.
   *
   * Creates a run for the given ticket and the resolved conductor. Returns a
   * 409 Conflict response when an active run for that ticket already exists.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming HTTP request carrying conductor attributes.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $bb_ticket
   *   The ticket entity to claim, resolved from the URL.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   A 201 response containing the newly created run entity.
   *
   * @throws \Symfony\Component\HttpKernel\Exception\ConflictHttpException
   *   When the ticket is already claimed by another conductor.
   */
  public function process(Request $request, BbTicketInterface $bb_ticket): ResourceResponse {
    try {
      $run = $this->ticketClaim->claim(
        $bb_ticket,
        $this->resolveConductor($request),
        $this->leaseSeconds($request),
      );
    }
    catch (ClaimConflictException $e) {
      throw new ConflictHttpException($e->getMessage(), $e);
    }
    return $this->createJsonapiResponse($this->createIndividualDataFromEntity($run), $request, 201);
  }

}
