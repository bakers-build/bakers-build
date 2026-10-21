<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\jsonapi\JsonApiResource\JsonApiDocumentTopLevel;
use Drupal\jsonapi\JsonApiResource\LinkCollection;
use Drupal\jsonapi\JsonApiResource\NullIncludedData;
use Drupal\jsonapi\JsonApiResource\ResourceObjectData;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Claims the next best matching ticket for the current conductor.
 */
final class ClaimNextResource extends EntityResourceBase implements ContainerInjectionInterface {

  use ConductorResolverTrait;

  /**
   * Constructs a ClaimNextResource.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param \Drupal\Core\Session\AccountInterface $current_user
   *   The current user account.
   * @param \Drupal\bb_core\Claim\TicketClaimService $ticketClaim
   *   The ticket claim service used to select and claim the next ticket.
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
   * Handles the claim-next POST request.
   *
   * Selects the highest-priority dispatchable ticket for the resolved conductor
   * and creates a run entity. Returns 204 No Content when the queue is empty.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming HTTP request carrying conductor attributes.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   A 201 run, 200 with refusal metadata, or 204 without a candidate.
   */
  public function process(Request $request): ResourceResponse {
    $result = $this->ticketClaim->claimNextResult(
      $this->resolveConductor($request),
      $this->leaseSeconds($request),
    );
    if ($result->capacity !== NULL) {
      return new ResourceResponse(new JsonApiDocumentTopLevel(
        new ResourceObjectData([], 1),
        new NullIncludedData(),
        new LinkCollection([]),
        [
          'claim' => [
            'reason' => 'machine_capacity',
            'occupancy' => $result->capacity->occupancy,
            'capacity' => $result->capacity->capacity,
            // Running leases are not liveness evidence or a release deadline.
            'retry_at' => NULL,
          ],
        ],
      ), 200);
    }
    if ($result->run === NULL) {
      return new ResourceResponse(NULL, 204);
    }
    return $this->createJsonapiResponse($this->createIndividualDataFromEntity($result->run), $request, 201);
  }

}
