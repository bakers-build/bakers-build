<?php

declare(strict_types=1);

namespace Drupal\bb_track\EventSubscriber;

use Drupal\jsonapi\ResourceType\ResourceTypeBuildEvent;
use Drupal\jsonapi\ResourceType\ResourceTypeBuildEvents;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Hides the Worklog owner from JSON:API.
 *
 * Project and ticket relationship GET routes stay readable. `work_schedule`
 * stays exposed on `user--user` so an owner can read their own schedule;
 * `WorkScheduleHooks::access()` forbids any other viewer, and writes stay
 * gated behind the checked `saveSchedule()` operation regardless of field
 * exposure.
 */
final class WorklogResourceTypeSubscriber implements EventSubscriberInterface {

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [
      ResourceTypeBuildEvents::BUILD => 'disableRelationships',
    ];
  }

  /**
   * Hides owner_user_id so JSON:API does not emit its relationship routes.
   */
  public function disableRelationships(ResourceTypeBuildEvent $event): void {
    if (!in_array($event->getResourceTypeName(), [
      'bb_track_worklog--bb_track_worklog',
      'bb_track_submission--bb_track_submission',
    ], TRUE)) {
      return;
    }
    foreach ($event->getFields() as $field) {
      if (in_array($field->getInternalName(), [
        'owner_user_id',
        'source_data',
        'source_keys',
        'source_revision',
        'voided',
      ], TRUE)) {
        $event->disableField($field);
      }
    }
  }

}
