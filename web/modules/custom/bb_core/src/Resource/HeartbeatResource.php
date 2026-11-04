<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Conductor\ConductorTakeoverOffer;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Records a conductor heartbeat, upserting the registration server-side.
 *
 * Keys on conductor_id, so it never 404s: a vanished
 * registration is recreated, an existing one is refreshed and brought online.
 * This moves the self-heal to the server — the conductor CLI just posts and
 * reads status.
 */
final class HeartbeatResource extends EntityResourceBase implements ContainerInjectionInterface {

  use ConductorResolverTrait;

  public function __construct(
    EntityTypeManagerInterface $entity_type_manager,
    AccountInterface $current_user,
    private readonly ConductorRegistrar $registrar,
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
      $container->get('bb_core.conductor_registrar'),
    );
  }

  /**
   * Handles the heartbeat POST request.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming request carrying the conductor registration attributes.
   *
   * @return \Symfony\Component\HttpFoundation\Response
   *   A 200 response with the upserted conductor entity, or a 409 whose
   *   `errors[0].meta.candidates` lists the conductors offered for takeover.
   */
  public function process(Request $request): Response {
    try {
      $conductor = $this->registrar->heartbeat(
        $this->currentUser,
        $this->requestAttributes($request),
      );
    }
    catch (ConductorTakeoverOffer $offer) {
      $error = [
        'status' => '409',
        'title' => 'Conflict',
        'detail' => $offer->getMessage(),
        'meta' => ['candidates' => $offer->candidates],
      ];
      return new JsonResponse(['errors' => [$error]], 409, ['Content-Type' => 'application/vnd.api+json']);
    }
    return $this->createJsonapiResponse($this->createIndividualDataFromEntity($conductor), $request, 200);
  }

}
