<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\State\StateInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketHealth;

/**
 * Maintains stored health at entity write boundaries.
 */
final class TicketHealthHooks {

  public function __construct(
    private readonly TicketHealth $health,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly StateInterface $state,
  ) {}

  /**
   * Implements hook_bb_ticket_presave().
   */
  #[Hook('bb_ticket_presave')]
  public function ticketPresave(BbTicketInterface $ticket): void {
    if ($this->health->refreshing) {
      return;
    }
    $original = $ticket->getOriginal();
    if ($original !== NULL) {
      foreach ($ticket->getFieldDefinitions() as $name => $definition) {
        if (!$definition->isComputed() && !str_starts_with($name, 'health') && $name !== 'changed'
          && !$ticket->get($name)->equals($original->get($name))) {
          $ticket->set('health_moved', $this->time->getRequestTime());
          break;
        }
      }
    }
    $this->health->apply($ticket, $this->health->evaluate([$ticket])[(int) $ticket->id()]);
  }

  /**
   * Tracks real state changes independently of log and transcript uploads.
   */
  #[Hook('bb_run_presave')]
  public function runPresave(BbRunInterface $run): void {
    if ($run->isNew() || $run->getRunState() !== $run->getOriginal()?->getRunState()) {
      $run->set('state_changed', $this->time->getRequestTime());
    }
  }

  /**
   * Implements run and activity save hooks.
   */
  #[Hook('bb_run_insert')]
  #[Hook('bb_run_update')]
  #[Hook('bb_activity_insert')]
  public function childSaved(ContentEntityInterface $entity): void {
    $id = $entity->get('ticket_id')->target_id;
    if ($id !== NULL) {
      // A cached reference can predate a ticket edit in this request.
      $this->refreshIds([$id]);
    }
  }

  /**
   * Parent and blocker changes can affect other tickets' exemptions.
   */
  #[Hook('bb_ticket_insert')]
  #[Hook('bb_ticket_update')]
  #[Hook('bb_ticket_delete')]
  public function ticketSaved(BbTicketInterface $ticket): void {
    if ($this->health->refreshing) {
      return;
    }
    $ids = array_filter([$ticket->getParentId(), $ticket->getOriginal()?->getParentId()]);
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = array_merge($ids, array_values($storage->getQuery()->accessCheck(FALSE)
      ->condition('closed', 0)->condition('blocked_by', $ticket->id())->execute()));
    $this->refreshIds(array_unique($ids));
  }

  /**
   * Implements hook_bb_conductor_update().
   */
  #[Hook('bb_conductor_update')]
  public function conductorUpdate(BbConductorInterface $conductor): void {
    if ($conductor->get('status')->value !== $conductor->getOriginal()?->get('status')->value
      || $conductor->get('owner_user_id')->target_id !== $conductor->getOriginal()?->get('owner_user_id')->target_id) {
      $this->refreshMatching('conductor_id', $conductor->id());
    }
  }

  /**
   * Implements hook_bb_term_update().
   */
  #[Hook('bb_term_update')]
  public function termUpdate(BbTermInterface $term): void {
    if ($term->bundle() === 'label' && $term->get('key')->value !== $term->getOriginal()?->get('key')->value) {
      $this->refreshMatching('labels', $term->id());
    }
  }

  /**
   * Refreshes open tickets referencing a changed fact.
   */
  private function refreshMatching(string $field, int|string|null $id): void {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(FALSE)->condition('closed', 0)->condition($field, $id)->execute();
    $this->refreshIds($ids);
  }

  /**
   * Evaluates elapsed time hourly, after conductor liveness is updated.
   */
  #[Hook('cron', order: new \Drupal\Core\Hook\Order\OrderAfter(classesAndMethods: [
    [ConductorLifecycleHooks::class, 'cron'],
  ]))]
  public function cron(): void {
    $now = $this->time->getRequestTime();
    $state = $this->state;
    if ($now - (int) $state->get('bb_core.ticket_health_cron', 0) < 3600) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $query = $storage->getQuery()->accessCheck(FALSE)->condition('closed', 0);
    $due = $query->orConditionGroup()
      ->condition($query->andConditionGroup()->condition('health', 'healthy')->condition('health_moved', $now - 2 * 86400, '<'))
      ->notExists('health')
      ->condition('health_reason', 'run_stalled');
    $run_storage = $this->entityTypeManager->getStorage('bb_run');
    $run_query = $run_storage->getQuery()->accessCheck(FALSE)->condition('changed', $now - TicketHealth::STALL_AFTER, '<');
    $run_query->condition($run_query->orConditionGroup()->condition('state', 'running')->condition($run_query->andConditionGroup()
      ->condition('state', 'claimed')->condition($run_query->orConditionGroup()->condition('claim_expires_at', 0)->condition('claim_expires_at', $now, '>='))));
    $run_ids = $run_query->execute();
    $ticket_ids = [];
    foreach ($run_storage->loadMultiple($run_ids) as $run) {
      if (!$run instanceof BbRunInterface) {
        continue;
      }
      $ticket_ids[] = (int) $run->get('ticket_id')->target_id;
    }
    if ($ticket_ids !== []) {
      $due->condition('id', array_unique($ticket_ids), 'IN');
    }
    $ids = $query->condition($due)->execute();
    foreach (array_chunk($ids, 100) as $batch) {
      $this->refreshIds($batch);
    }
    $state->set('bb_core.ticket_health_cron', $now);
  }

  /**
   * Loads a batch of ticket references without access-dependent health.
   *
   * @param array<int|string> $ids
   *   Ticket ids.
   */
  private function refreshIds(array $ids): void {
    $tickets = array_filter($this->entityTypeManager->getStorage('bb_ticket')->loadMultiple($ids),
      static fn ($entity): bool => $entity instanceof BbTicketInterface);
    $this->health->refresh($tickets);
  }

}
