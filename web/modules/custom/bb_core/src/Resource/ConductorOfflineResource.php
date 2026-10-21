<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Marks one conductor offline through a narrow lifecycle POST.
 *
 * The body is ignored: the operation accepts no caller-selected values.
 * It cannot create a conductor. Repeating it is harmless.
 */
final class ConductorOfflineResource extends EntityResourceBase implements ContainerInjectionInterface {

  /**
   * Constructs a ConductorOfflineResource.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The current user account.
   * @param \Drupal\bb_core\Conductor\ConductorRegistrar $registrar
   *   The conductor registrar used to apply the offline mutation.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $rankCapability
   *   Rank capability, used for the instance-admin bypass.
   */
  public function __construct(
    EntityTypeManagerInterface $entity_type_manager,
    private readonly AccountInterface $currentUser,
    private readonly ConductorRegistrar $registrar,
    private readonly BbRankCapabilityInterface $rankCapability,
  ) {
    $this->entityTypeManager = $entity_type_manager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('bb_core.conductor_registrar'),
      $container->get('bb_core.rank_capability'),
    );
  }

  /**
   * Handles the conductor-offline POST.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming request. Attributes in the body are discarded.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $bb_conductor
   *   The conductor resolved from the URL.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   A 200 response with the updated conductor.
   */
  public function process(Request $request, BbConductorInterface $bb_conductor): ResourceResponse {
    $this->assertMayTakeOffline($bb_conductor);
    $updated = $this->registrar->offline($bb_conductor);
    $document = $this->createIndividualDataFromEntity($updated);
    return $this->createJsonapiResponse($document, $request, 200);
  }

  /**
   * Requires entity update plus ownership, or instance-admin authority.
   */
  private function assertMayTakeOffline(BbConductorInterface $conductor): void {
    if (!$conductor->access('update', $this->currentUser)) {
      throw new AccessDeniedHttpException(
        'The current user may not update this conductor.',
      );
    }
    if (
      !$conductor->isOwnedBy($this->currentUser)
      && !$this->rankCapability->isInstanceAdmin($this->currentUser)
    ) {
      throw new AccessDeniedHttpException(
        'The current user may not take this conductor offline.',
      );
    }
  }

}
