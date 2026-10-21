<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Offers every saved entity to the kinds that listen to its trigger.
 *
 * The trigger is `<entity type>:insert` or `<entity type>:update`; the facts
 * are `entity` and, on an update, `original`. It names no kind, no entity
 * type and decides nothing. It runs inside the save transaction, so a
 * rolled-back write leaves no row and a failing kind rolls the write back.
 */
final class ActivityTriggerHooks {

  public function __construct(
    #[Autowire(service: 'plugin.manager.bb_activity_kind')]
    private readonly ActivityKindManager $kinds,
  ) {}

  /**
   * Implements hook_entity_insert().
   */
  #[Hook('entity_insert')]
  public function entityInsert(EntityInterface $entity): void {
    $this->kinds->trigger($entity->getEntityTypeId() . ':insert', ['entity' => $entity]);
  }

  /**
   * Implements hook_entity_update().
   */
  #[Hook('entity_update')]
  public function entityUpdate(EntityInterface $entity): void {
    $this->kinds->trigger($entity->getEntityTypeId() . ':update', [
      'entity' => $entity,
      'original' => $entity->getOriginal(),
    ]);
  }

}
