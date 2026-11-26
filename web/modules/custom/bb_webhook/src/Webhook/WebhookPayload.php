<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Webhook;

use Drupal\bb_activity\Entity\BbActivity;
use Drupal\Core\Entity\ContentEntityInterface;

/**
 * The JSON body of one activity and the signature a receiver recomputes.
 */
final class WebhookPayload {

  /**
   * Builds the JSON body of an activity.
   */
  public static function build(BbActivity $activity): string {
    $ticket = $activity->get('ticket_id')->entity;
    $project = $ticket?->get('project_id')->entity;
    $workspace = $project?->get('group_id')->entity?->get('workspace_id')->entity;
    $actor = $activity->get('actor')->entity;
    return (string) json_encode([
      'event' => (string) $activity->get('kind')->value,
      'id' => (string) $activity->uuid(),
      'occurred' => gmdate('c', $activity->getCreatedTime()),
      'workspace' => $workspace?->uuid(),
      'project' => $project?->uuid(),
      'ticket' => $ticket instanceof ContentEntityInterface ? [
        'uuid' => $ticket->uuid(),
        'identifier' => (string) $ticket->get('identifier')->value,
        'title' => (string) $ticket->get('title')->value,
        'state' => (string) $ticket->get('state')->value,
        'url' => $ticket->toUrl('canonical', ['absolute' => TRUE])->toString(),
      ] : NULL,
      'actor' => $actor?->uuid(),
      'previous_state' => (string) $activity->get('previous_state')->value,
      'new_state' => (string) $activity->get('new_state')->value,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
  }

  /**
   * The `X-Bakers-Signature` value: HMAC-SHA256 of "<timestamp>.<body>".
   */
  public static function sign(string $secret, int $timestamp, string $body): string {
    return 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secret);
  }

}
