<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;

/**
 * Recent ticket activities of one detail page's scope.
 *
 * Project, team and group reach their tickets through the project. Conductor
 * and machine reach activities only through the activity's own run, never the
 * ticket's current assignment, so an event without a run is in neither feed.
 */
final class EntityDetailActivities {

  /**
   * How many rows a feed shows.
   */
  public const LIMIT = 20;

  /**
   * Candidates fetched per query while filling the feed.
   */
  private const BATCH = 50;

  /**
   * Loads activities and their scope.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * The newest activities the current account may see, at most LIMIT.
   *
   * @return list<\Drupal\bb_activity\Entity\BbActivity>
   *   Activities, created then id descending.
   *
   * @throws \InvalidArgumentException
   *   For an entity type without a detail feed.
   */
  public function activities(EntityInterface $entity): array {
    $query = $this->scopedQuery($entity);
    if ($query === NULL) {
      return [];
    }
    $storage = $this->entityTypeManager->getStorage('bb_activity');
    $rows = [];
    // Candidates are re-checked one by one; a removed candidate is replaced by
    // the next one instead of shortening the feed.
    $offset = 0;
    do {
      $ids = (array) (clone $query)->range($offset, self::BATCH)->execute();
      foreach ($storage->loadMultiple($ids) as $activity) {
        if ($activity instanceof BbActivity && $this->visible($activity, $entity)) {
          $rows[] = $activity;
        }
      }
      $offset += self::BATCH;
      $more = count($ids) === self::BATCH && count($rows) < self::LIMIT;
    } while ($more);
    return array_slice($rows, 0, self::LIMIT);
  }

  /**
   * The access-checked candidate query, or NULL when the scope is empty.
   */
  private function scopedQuery(EntityInterface $entity): ?QueryInterface {
    $query = $this->entityTypeManager->getStorage('bb_activity')->getQuery()
      ->accessCheck(TRUE)
      ->sort('created', 'DESC')
      ->sort('id', 'DESC');
    $id = $entity->id();
    switch ($entity->getEntityTypeId()) {
      case 'bb_conductor':
        return $query->condition('run_id.entity:bb_run.conductor_id', $id);

      case 'bb_machine':
        return $query->condition('run_id.entity:bb_run.conductor_id.entity:bb_conductor.machine', $id);

      case 'bb_project':
        $projects = [$id];
        break;

      case 'bb_team':
        $projects = $this->projectIds('teams', $id);
        break;

      case 'bb_group':
        $projects = $this->projectIds('group_id', $id);
        break;

      default:
        throw new \InvalidArgumentException(sprintf('No activity feed for %s.', $entity->getEntityTypeId()));
    }
    if ($projects === []) {
      return NULL;
    }
    // Ticket ids rather than a ticket_id.entity.project_id relationship, which
    // query access cannot see; activity access gates the ticket.
    $tickets = $this->entityTypeManager->getStorage('bb_ticket')->getQuery()
      ->accessCheck(FALSE)
      ->condition('project_id', $projects, 'IN')
      ->execute();
    return $tickets === [] ? NULL : $query->condition('ticket_id', array_values($tickets), 'IN');
  }

  /**
   * Projects whose reference field points at the entity.
   *
   * @return list<int|string>
   *   Project ids.
   */
  private function projectIds(string $field, int|string|null $id): array {
    return array_values($this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition($field, $id)
      ->execute());
  }

  /**
   * Final per-row check; a run feed also needs its readable run chain.
   */
  private function visible(BbActivity $activity, EntityInterface $entity): bool {
    if (!$activity->access('view')) {
      return FALSE;
    }
    if (!in_array($entity->getEntityTypeId(), ['bb_conductor', 'bb_machine'], TRUE)) {
      return TRUE;
    }
    $run = $activity->get('run_id')->entity;
    $conductor = $run instanceof BbRunInterface ? $run->get('conductor_id')->entity : NULL;
    if (!$conductor instanceof BbConductorInterface || !$run->access('view') || !$conductor->access('view')) {
      return FALSE;
    }
    return $entity->getEntityTypeId() === 'bb_conductor'
      ? $conductor->id() === $entity->id()
      : $conductor->get('machine')->target_id == $entity->id();
  }

}
