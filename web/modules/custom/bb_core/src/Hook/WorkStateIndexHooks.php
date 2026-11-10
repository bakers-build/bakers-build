<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Plugin\search_api\datasource\ContentEntityTrackingManager;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Keeps the indexed work_state current when a blocker or a run changes.
 *
 * The work_state depends on the ticket's blockers and runs, which Search API
 * does not see as dependencies of the ticket, so the affected tickets are
 * queued for re-indexing by hand. Without Search API there is nothing to keep.
 */
final class WorkStateIndexHooks {

  public function __construct(
    #[Autowire(service: 'entity_type.manager')]
    private readonly EntityTypeManagerInterface $entityTypeManager,
    #[Autowire(service: 'bb_core.ticket_run_deriver')]
    private readonly TicketRunDeriver $runDeriver,
    #[Autowire(service: 'search_api.entity_datasource.tracking_manager')]
    private readonly ?ContentEntityTrackingManager $tracking = NULL,
  ) {
  }

  /**
   * Implements hook_ENTITY_TYPE_update() for bb_ticket.
   *
   * A blocker that opens or closes changes the tickets it blocks.
   */
  #[Hook('bb_ticket_update')]
  public function ticketUpdate(EntityInterface $ticket): void {
    $original = $ticket instanceof BbTicketInterface ? $ticket->getOriginal() : NULL;
    if (!$original instanceof BbTicketInterface
      || ($ticket->get('closed')->value === $original->get('closed')->value
        && $ticket->get('state')->value === $original->get('state')->value)) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('blocked_by', $ticket->id())
      ->execute();
    $this->track($ids);
  }

  /**
   * Implements hook_ENTITY_TYPE_insert() for bb_run.
   */
  #[Hook('bb_run_insert')]
  public function runInsert(EntityInterface $run): void {
    $this->trackRunTicket($run);
  }

  /**
   * Implements hook_ENTITY_TYPE_update() for bb_run.
   */
  #[Hook('bb_run_update')]
  public function runUpdate(EntityInterface $run): void {
    $this->trackRunTicket($run);
  }

  /**
   * Re-indexes the run's ticket after the live-run answer may have changed.
   */
  private function trackRunTicket(EntityInterface $run): void {
    if (!$run instanceof BbRunInterface || $run->get('ticket_id')->isEmpty()) {
      return;
    }
    $ticketId = (int) $run->get('ticket_id')->target_id;
    $this->runDeriver->invalidate($ticketId);
    $this->track([$ticketId]);
  }

  /**
   * Queues tickets for re-indexing with a fresh computed work_state.
   *
   * @param array<int|string> $ids
   *   Ticket ids.
   */
  private function track(array $ids): void {
    if ($this->tracking === NULL || $ids === []) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    // A cached entity keeps its computed work_state from before the change.
    $storage->resetCache($ids);
    foreach ($storage->loadMultiple($ids) as $ticket) {
      if ($ticket instanceof ContentEntityInterface) {
        $this->tracking->trackEntityChange($ticket);
      }
    }
  }

}
