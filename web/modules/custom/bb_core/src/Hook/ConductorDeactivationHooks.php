<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Conductor\ConductorDeactivationReassigner;
use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * Reassigns tickets when a conductor crosses from active to inactive.
 */
final class ConductorDeactivationHooks {

  public function __construct(
    private readonly ConductorDeactivationReassigner $reassigner,
  ) {
  }

  /**
   * Implements hook_bb_conductor_update().
   */
  #[Hook('bb_conductor_update')]
  public function conductorUpdate(EntityInterface $entity): void {
    if (!$entity instanceof BbConductorInterface) {
      return;
    }
    $original = $entity->getOriginal();
    if (!$original instanceof BbConductorInterface
      || (bool) $entity->get('active')->value
      || !(bool) $original->get('active')->value) {
      return;
    }
    $this->reassigner->reassign($entity);
  }

}
