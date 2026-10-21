<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Records a conductor heartbeat, upserting the registration server-side.
 *
 * Keys on conductor_id (legacy machine_id alias), so it never 404s: a vanished
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
   * @return \Drupal\jsonapi\ResourceResponse
   *   A 200 response with the upserted conductor entity.
   */
  public function process(Request $request): ResourceResponse {
    $conductor = $this->registrar->heartbeat(
      $this->currentUser,
      $this->requestAttributes($request),
    );
    return $this->createJsonapiResponse($this->createIndividualDataFromEntity($conductor), $request, 200);
  }

}
