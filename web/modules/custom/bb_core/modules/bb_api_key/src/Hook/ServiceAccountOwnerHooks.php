<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\UserInterface;

/**
 * Keeps service accounts from owning a workspace or team.
 *
 * A group owner would get full access if `group_manager_full_access` were
 * on, so this fails closed however the owner write is reached.
 */
final class ServiceAccountOwnerHooks {

  public function __construct(
    private readonly ServiceAccountManager $serviceAccountManager,
  ) {}

  /**
   * Implements hook_entity_presave().
   */
  #[Hook('entity_presave')]
  public function entityPresave(EntityInterface $entity): void {
    if (!in_array($entity->getEntityTypeId(), ['bb_workspace', 'bb_team'], TRUE) || !$entity instanceof EntityOwnerInterface) {
      return;
    }
    $owner = $entity->getOwner();
    if ($owner instanceof UserInterface && $this->serviceAccountManager->isServiceAccount($owner)) {
      throw new EntityStorageException('A service account cannot own a workspace or team.');
    }
  }

}
