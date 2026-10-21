<?php

declare(strict_types=1);

namespace Drupal\bb_track\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkTimeRules;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Read-only personal worklogs without exposing generic owner relationships.
 */
final class WorklogEvidenceController extends ControllerBase {

  /**
   * Returns one date-bounded page belonging to the authenticated employee.
   */
  public function read(Request $request): JsonResponse {
    if ($this->currentUser()->isAnonymous()) {
      return $this->response(['error' => 'Sign in to read personal time.'], 403);
    }
    try {
      [$from, $to, $limit, $offset] = $this->selection($request);
    }
    catch (\InvalidArgumentException $error) {
      return $this->response(['error' => $error->getMessage()], 400);
    }
    $storage = $this->entityTypeManager()->getStorage('bb_track_worklog');
    $ids = array_values($storage->getQuery()->accessCheck(TRUE)
      ->condition('owner_user_id', $this->currentUser()->id())
      ->condition('voided', 0)
      ->condition('work_date', $from, '>=')
      ->condition('work_date', $to, '<=')
      ->sort('id')->range($offset, $limit + 1)->execute());
    $more = count($ids) > $limit;
    $entries = $storage->loadMultiple(array_slice($ids, 0, $limit));
    $references = $this->references($entries);
    $owner = $this->entityTypeManager()->getStorage('user')->load($this->currentUser()->id());
    $data = [];
    $omitted = FALSE;
    foreach ($entries as $entry) {
      assert($entry instanceof Worklog);
      $relationships = ['owner_user_id' => ['data' => ['type' => 'user--user', 'id' => $owner->uuid()]]];
      foreach ($references as $field => $entities) {
        $entity = $entities[$entry->get($field)->target_id] ?? NULL;
        $omitted = $omitted || ($entry->get($field)->target_id !== NULL && $entity === NULL);
        $relationships[$field] = ['data' => $entity ? $this->identity($entity) : NULL];
      }
      $data[] = $this->identity($entry) + [
        'attributes' => [
          'work_date' => $entry->get('work_date')->value,
          'state' => $entry->get('state')->value,
          'duration_seconds' => (int) $entry->get('duration_seconds')->value,
          'description' => $entry->get('description')->value,
          'source_keys' => array_column($entry->get('source_keys')->getValue(), 'value'),
        ],
        'relationships' => $relationships,
      ];
    }
    return $this->response([
      'data' => $data,
      'included' => $this->included($references),
      'meta' => ['omitted' => $omitted ? ['detail' => 'Some assignment context is unavailable.'] : NULL],
      'links' => [
        'next' => $more ? '?' . http_build_query([
          'from' => $from,
          'to' => $to,
          'page' => ['limit' => $limit, 'offset' => $offset + $limit],
        ]) : NULL,
      ],
    ]);
  }

  /**
   * Builds sparse ticket/project context from the readable references.
   */
  private function included(array $references): array {
    $included = [];
    foreach ($references['project_id'] as $project) {
      $included[] = $this->identity($project) + ['attributes' => ['name' => $project->label()]];
    }
    foreach ($references['ticket_id'] as $ticket) {
      $project = $references['project_id'][$ticket->get('project_id')->target_id] ?? NULL;
      $included[] = $this->identity($ticket) + [
        'attributes' => ['identifier' => $ticket->get('identifier')->value, 'title' => $ticket->label()],
        'relationships' => ['project_id' => ['data' => $project ? $this->identity($project) : NULL]],
      ];
    }
    return $included;
  }

  /**
   * Validates the complete query; there is deliberately no owner selector.
   */
  private function selection(Request $request): array {
    $query = $request->query->all();
    if (array_diff(array_keys($query), ['from', 'to', 'page'])) {
      throw new \InvalidArgumentException('Only from, to and page are supported.');
    }
    $from = WorkTimeRules::date($query['from'] ?? NULL);
    $to = WorkTimeRules::date($query['to'] ?? NULL);
    if ($to < $from || (new \DateTimeImmutable($from))->diff(new \DateTimeImmutable($to))->days > 377) {
      throw new \InvalidArgumentException('Select at most 378 civil dates, in order.');
    }
    $page = $query['page'] ?? [];
    if (!is_array($page) || array_diff(array_keys($page), ['limit', 'offset'])) {
      throw new \InvalidArgumentException('Invalid page.');
    }
    $limit = filter_var($page['limit'] ?? 50, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 50]]);
    $offset = filter_var($page['offset'] ?? 0, FILTER_VALIDATE_INT, [
      'options' => ['min_range' => 0, 'max_range' => PHP_INT_MAX - 50],
    ]);
    if ($limit === FALSE || $offset === FALSE) {
      throw new \InvalidArgumentException('Invalid page limit or offset.');
    }
    return [$from, $to, $limit, $offset];
  }

  /**
   * Batch-loads only readable context; never widens assignment access.
   */
  private function references(array $entries): array {
    $references = [];
    foreach (['project_id' => 'bb_project', 'ticket_id' => 'bb_ticket', 'submission_id' => 'bb_track_submission'] as $field => $type) {
      $ids = [];
      foreach ($entries as $entry) {
        $id = $entry->get($field)->target_id;
        if ($id !== NULL) {
          $ids[] = $id;
        }
      }
      $entities = $this->entityTypeManager()->getStorage($type)->loadMultiple(array_unique($ids));
      $references[$field] = array_filter($entities, fn(EntityInterface $entity) => $entity->access('view', $this->currentUser()));
    }
    return $references;
  }

  /**
   * Resource identity shared by rows and references.
   */
  private function identity(EntityInterface $entity): array {
    return ['type' => $entity->getEntityTypeId() . '--' . $entity->bundle(), 'id' => $entity->uuid()];
  }

  /**
   * Personal evidence must not be reused by a shared cache.
   */
  private function response(array $body, int $status = 200): JsonResponse {
    return new JsonResponse($body, $status, ['Cache-Control' => 'private, no-store']);
  }

}
