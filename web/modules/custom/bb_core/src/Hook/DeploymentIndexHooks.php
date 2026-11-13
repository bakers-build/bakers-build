<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Plugin\search_api\datasource\ContentEntityTrackingManager;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Reindexes carried tickets when their deployment relationship changes.
 */
final class DeploymentIndexHooks {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    #[Autowire(service: 'search_api.entity_datasource.tracking_manager')]
    private readonly ?ContentEntityTrackingManager $tracking = NULL,
  ) {
  }

  /**
   * Tracks both sides of a changed batch, including deletion and type changes.
   */
  #[Hook('bb_ticket_insert')]
  #[Hook('bb_ticket_update')]
  #[Hook('bb_ticket_delete')]
  public function trackDeployment(EntityInterface $entity): void {
    if (!$entity instanceof BbTicketInterface || $this->tracking === NULL) {
      return;
    }
    $ids = [];
    foreach ([$entity->getOriginal(), $entity] as $ticket) {
      if ($ticket instanceof BbTicketInterface && $ticket->get('ticket_type')->entity?->label() === 'deployment') {
        $ids = [...$ids, ...array_column($ticket->get('referenced_tickets')->getValue(), 'target_id')];
      }
    }
    if ($ids === []) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = array_unique($ids);
    $storage->resetCache($ids);
    foreach ($storage->loadMultiple($ids) as $ticket) {
      if ($ticket instanceof ContentEntityInterface) {
        $this->tracking->trackEntityChange($ticket);
      }
    }
  }

}
