<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\State\StateInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Hook\Order\OrderAfter;
use Drupal\Core\Entity\EntityLastInstalledSchemaRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Drupal\og\OgMembershipInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketHealth;
use Drupal\bb_core\Derive\TicketRunDeriver;

/**
 * Maintains stored health at entity write boundaries.
 */
final class TicketHealthHooks {

  public function __construct(
    private readonly TicketHealth $health,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly StateInterface $state,
    private readonly TicketRunDeriver $runs,
    #[Autowire(service: 'entity.last_installed_schema.repository')]
    private readonly EntityLastInstalledSchemaRepositoryInterface $installedSchema,
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
    if ($conductor->get('status')->value !== $conductor->getOriginal()?->get('status')->value) {
      $this->refreshMatching('conductor_id', $conductor->id());
    }
  }

  /**
   * A membership or rank change can grant or revoke a conductor owner's access.
   */
  #[Hook('og_membership_insert', order: new OrderAfter(classesAndMethods: [
    [WorkspaceMembershipHooks::class, 'ogMembershipInsert'],
  ]))]
  #[Hook('og_membership_update', order: new OrderAfter(classesAndMethods: [
    [WorkspaceMembershipHooks::class, 'ogMembershipUpdate'],
  ]))]
  #[Hook('og_membership_delete', order: new OrderAfter(classesAndMethods: [
    [WorkspaceMembershipHooks::class, 'ogMembershipDelete'],
  ]))]
  public function membershipChanged(OgMembershipInterface $membership): void {
    // Kernel tests may create memberships without the conductor table.
    if ($this->installedSchema->getLastInstalledDefinition('bb_conductor') === NULL) {
      return;
    }
    $conductors = $this->entityTypeManager->getStorage('bb_conductor')->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $membership->getOwnerId())->execute();
    if ($conductors !== []) {
      $this->refreshMatching('conductor_id', $conductors);
    }
  }

  /**
   * A project's teams or group decide which conductor owners may work in it.
   */
  #[Hook('bb_project_update', order: new OrderAfter(classesAndMethods: [
    [ProjectReadScopeHooks::class, 'projectWrite'],
  ]))]
  public function projectUpdate(BbProjectInterface $project): void {
    // Kernel tests may save projects without the ticket table.
    if ($this->installedSchema->getLastInstalledDefinition('bb_ticket') === NULL) {
      return;
    }
    $original = $project->getOriginal();
    if ($original === NULL || !$project->get('teams')->equals($original->get('teams'))
      || !$project->get('group_id')->equals($original->get('group_id'))) {
      $this->refreshMatching('project_id', $project->id());
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
  private function refreshMatching(string $field, int|string|array|null $id): void {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(FALSE)->condition('closed', 0)->condition($field, $id, is_array($id) ? 'IN' : '=')->execute();
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
    /** @var array<int, array<string, int|string>> $rows */
    $rows = $this->runs->live($this->entityTypeManager->getStorage('bb_run')->getAggregateQuery()->accessCheck(FALSE)
      ->condition('changed', $now - TicketHealth::STALL_AFTER, '<'))->groupBy('ticket_id')->execute();
    if ($rows !== []) {
      $due->condition('id', array_column($rows, 'ticket_id'), 'IN');
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
