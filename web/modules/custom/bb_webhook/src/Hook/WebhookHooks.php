<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Hook;

use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_webhook\Webhook\WebhookPayload;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Queue\QueueFactory;

/**
 * Queues one delivery per enabled webhook covering an activity's ticket.
 *
 * No HTTP on the request path: the queue worker sends on cron.
 */
final class WebhookHooks {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly QueueFactory $queueFactory,
  ) {}

  /**
   * Implements hook_ENTITY_TYPE_insert() for bb_activity.
   */
  #[Hook('bb_activity_insert')]
  public function activityInsert(BbActivity $activity): void {
    $ticket = $activity->get('ticket_id')->entity;
    $project = $ticket instanceof BbTicketInterface ? $ticket->getProject() : NULL;
    $group = $project?->getGroup();
    $workspace_id = $group?->get('workspace_id')->target_id;
    if ($project === NULL || $group === NULL || $workspace_id === NULL) {
      return;
    }
    $query = $this->entityTypeManager->getStorage('bb_webhook')->getQuery()->accessCheck(FALSE);
    $workspace_scope = $query->andConditionGroup()
      ->notExists('project_id')
      ->notExists('group_id');
    $covering = $query->orConditionGroup()
      ->condition('project_id', $project->id())
      ->condition('group_id', $group->id())
      ->condition($workspace_scope);
    $ids = $query
      ->condition('enabled', TRUE)
      ->condition('workspace_id', $workspace_id)
      ->condition($covering)
      ->execute();
    if ($ids === []) {
      return;
    }
    $body = WebhookPayload::build($activity);
    $queue = $this->queueFactory->get('bb_webhook_delivery');
    foreach ($ids as $id) {
      $queue->createItem([
        'webhook' => (int) $id,
        'body' => $body,
        'event' => (string) $activity->get('kind')->value,
        'delivery' => (string) $activity->uuid(),
        'attempt' => 1,
      ]);
    }
  }

}
