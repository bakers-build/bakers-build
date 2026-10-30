<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkTimeRules;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Reads one date-bounded page of the caller's own worklogs.
 */
#[Tool(
  id: 'bakers_worklog_list',
  label: new TranslatableMarkup('List own worklogs'),
  description: new TranslatableMarkup("Returns the caller’s own non-voided worklogs between two civil dates (at most 378 days), with the readable projects and tickets they reference. A reference the caller cannot read is null and sets omitted."),
  operation: ToolOperation::Read,
  input_definitions: [
    'from' => new InputDefinition('string', new TranslatableMarkup('From'), new TranslatableMarkup('First civil date, Y-m-d.')),
    'to' => new InputDefinition('string', new TranslatableMarkup('To'), new TranslatableMarkup('Last civil date, Y-m-d.')),
    'limit' => new InputDefinition('integer', new TranslatableMarkup('Limit'), new TranslatableMarkup('Rows per page, 1 to 50.'), required: FALSE, default_value: 50),
    'offset' => new InputDefinition('integer', new TranslatableMarkup('Offset'), new TranslatableMarkup('Rows to skip; use next_offset of the previous page.'), required: FALSE, default_value: 0),
  ],
  output_definitions: [
    'data' => new ListOutputDefinition(
      label: new TranslatableMarkup('Worklogs'),
      description: new TranslatableMarkup('The page, oldest first by creation.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Worklog'),
        description: new TranslatableMarkup('One worklog.'),
        property_definitions: [
          'id' => new OutputDefinition('string', new TranslatableMarkup('UUID'), new TranslatableMarkup('Worklog UUID.')),
          'work_date' => new OutputDefinition('string', new TranslatableMarkup('Work date'), new TranslatableMarkup('Civil date, Y-m-d.')),
          'state' => new OutputDefinition('string', new TranslatableMarkup('State'), new TranslatableMarkup('recorded, proposed, …')),
          'duration_seconds' => new OutputDefinition('integer', new TranslatableMarkup('Duration'), new TranslatableMarkup('Seconds.')),
          'description' => new OutputDefinition('string', new TranslatableMarkup('Description'), new TranslatableMarkup('What was done.')),
          'source_keys' => new ListOutputDefinition(
            label: new TranslatableMarkup('Source keys'),
            description: new TranslatableMarkup('Hashed source identities.'),
            item_definition: new OutputDefinition('string', new TranslatableMarkup('Source key'), new TranslatableMarkup('A hashed source identity.')),
          ),
          'project_id' => new OutputDefinition('string', new TranslatableMarkup('Project'), new TranslatableMarkup('Project UUID, or null.'), nullable: TRUE),
          'ticket_id' => new OutputDefinition('string', new TranslatableMarkup('Ticket'), new TranslatableMarkup('Ticket UUID, or null.'), nullable: TRUE),
          'submission_id' => new OutputDefinition('string', new TranslatableMarkup('Submission'), new TranslatableMarkup('Submission UUID, or null.'), nullable: TRUE),
        ],
      ),
    ),
    'projects' => new ListOutputDefinition(
      label: new TranslatableMarkup('Projects'),
      description: new TranslatableMarkup('Readable referenced projects.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Project'),
        description: new TranslatableMarkup('One project.'),
        property_definitions: [
          'id' => new OutputDefinition('string', new TranslatableMarkup('UUID'), new TranslatableMarkup('Project UUID.')),
          'name' => new OutputDefinition('string', new TranslatableMarkup('Name'), new TranslatableMarkup('Project name.')),
        ],
      ),
    ),
    'tickets' => new ListOutputDefinition(
      label: new TranslatableMarkup('Tickets'),
      description: new TranslatableMarkup('Readable referenced tickets.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One ticket.'),
        property_definitions: [
          'id' => new OutputDefinition('string', new TranslatableMarkup('UUID'), new TranslatableMarkup('Ticket UUID.')),
          'identifier' => new OutputDefinition('string', new TranslatableMarkup('Identifier'), new TranslatableMarkup('Ticket identifier.'), nullable: TRUE),
          'title' => new OutputDefinition('string', new TranslatableMarkup('Title'), new TranslatableMarkup('Ticket title.')),
          'project_id' => new OutputDefinition('string', new TranslatableMarkup('Project'), new TranslatableMarkup('Project UUID, or null when unreadable.'), nullable: TRUE),
        ],
      ),
    ),
    'omitted' => new OutputDefinition('boolean', new TranslatableMarkup('Omitted'), new TranslatableMarkup('TRUE when some referenced context is unreadable.')),
    'next_offset' => new OutputDefinition('integer', new TranslatableMarkup('Next offset'), new TranslatableMarkup('Offset of the next page, or null on the last page.'), nullable: TRUE),
  ],
)]
final class WorklogList extends ToolBase {

  /**
   * Loads worklogs and their references.
   */
  private EntityTypeManagerInterface $entities;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    // ToolBase's constructor is final, so the service is set here.
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entities = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    [$from, $to, $limit, $offset] = $this->selection($values);
    $storage = $this->entities->getStorage('bb_track_worklog');
    // There is deliberately no owner selector.
    $ids = array_values($storage->getQuery()->accessCheck(TRUE)
      ->condition('owner_user_id', $this->currentUser->id())
      ->condition('voided', 0)
      ->condition('work_date', $from, '>=')
      ->condition('work_date', $to, '<=')
      ->sort('id')->range($offset, $limit + 1)->execute());
    $more = count($ids) > $limit;
    /** @var array<int, \Drupal\bb_track\Entity\Worklog> $entries */
    $entries = $storage->loadMultiple(array_slice($ids, 0, $limit));
    $references = $this->references($entries);
    $data = [];
    $omitted = FALSE;
    foreach ($entries as $entry) {
      assert($entry instanceof Worklog);
      $row = [
        'id' => $entry->uuid(),
        'work_date' => $entry->get('work_date')->value,
        'state' => $entry->get('state')->value,
        'duration_seconds' => (int) $entry->get('duration_seconds')->value,
        'description' => $entry->get('description')->value,
        'source_keys' => array_column($entry->get('source_keys')->getValue(), 'value'),
      ];
      foreach ($references as $field => $readable) {
        $entity = $readable[$entry->get($field)->target_id] ?? NULL;
        $omitted = $omitted || ($entry->get($field)->target_id !== NULL && $entity === NULL);
        $row[$field] = $entity?->uuid();
      }
      $data[] = $row;
    }
    $projects = array_map(fn(EntityInterface $project) => ['id' => $project->uuid(), 'name' => $project->label()], array_values($references['project_id']));
    $tickets = array_map(fn(ContentEntityInterface $ticket) => [
      'id' => $ticket->uuid(),
      'identifier' => $ticket->get('identifier')->value,
      'title' => $ticket->label(),
      'project_id' => ($references['project_id'][$ticket->get('project_id')->target_id] ?? NULL)?->uuid(),
    ], array_values($references['ticket_id']));
    return ExecutableResult::success(new TranslatableMarkup('@count worklogs.', ['@count' => count($data)]), [
      'data' => $data,
      'projects' => $projects,
      'tickets' => $tickets,
      'omitted' => $omitted,
      'next_offset' => $more ? $offset + $limit : NULL,
    ]);
  }

  /**
   * Validates the date range and page.
   *
   * @param array<string, mixed> $values
   *   The tool inputs.
   *
   * @return array{string, string, int, int}
   *   From, to, limit and offset.
   *
   * @throws \InvalidArgumentException
   */
  private function selection(array $values): array {
    $from = WorkTimeRules::date($values['from']);
    $to = WorkTimeRules::date($values['to']);
    if ($to < $from || (new \DateTimeImmutable($from))->diff(new \DateTimeImmutable($to))->days > 377) {
      throw new \InvalidArgumentException('Select at most 378 civil dates, in order.');
    }
    $limit = filter_var($values['limit'] ?? 50, FILTER_VALIDATE_INT, [
      'options' => ['min_range' => 1, 'max_range' => 50],
    ]);
    $offset = filter_var($values['offset'] ?? 0, FILTER_VALIDATE_INT, [
      'options' => ['min_range' => 0, 'max_range' => PHP_INT_MAX - 50],
    ]);
    if ($limit === FALSE || $offset === FALSE) {
      throw new \InvalidArgumentException('Invalid page limit or offset.');
    }
    return [$from, $to, $limit, $offset];
  }

  /**
   * Batch-loads only readable context; never widens assignment access.
   *
   * @param array<int|string, \Drupal\Core\Entity\ContentEntityInterface> $entries
   *   The page's worklogs.
   *
   * @return array<string, array<int|string, \Drupal\Core\Entity\ContentEntityInterface>>
   *   Readable entities keyed by reference field, then id.
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
      /** @var array<int|string, \Drupal\Core\Entity\ContentEntityInterface> $entities */
      $entities = $this->entities->getStorage($type)->loadMultiple(array_unique($ids));
      $references[$field] = array_filter($entities, fn(EntityInterface $entity) => $entity->access('view', $this->currentUser));
    }
    return $references;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    $access = AccessResult::allowedIf($account->isAuthenticated())->cachePerUser();
    return $return_as_object ? $access : $access->isAllowed();
  }

}
