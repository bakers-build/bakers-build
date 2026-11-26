<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Lists every readable ticket of one project, closed ones included.
 */
#[Tool(
  id: 'bakers_ticket_list',
  label: new TranslatableMarkup('List tickets'),
  description: new TranslatableMarkup('Lists every ticket of a project you can read, closed ones included, oldest first, page by page; optionally only open or closed ones, most recently changed first. Each row has its UUID, identifier, title, state, links, label names, freeze state, parent UUID, whether it is closed, its type, when it changed and its active run.'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'limit' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Limit'),
      description: new TranslatableMarkup('Rows per page, 1-100; default 50.'),
      required: FALSE,
    ),
    'offset' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Offset'),
      description: new TranslatableMarkup('Rows to skip; default 0.'),
      required: FALSE,
    ),
    'closed' => new InputDefinition(
      data_type: 'boolean',
      label: new TranslatableMarkup('Closed'),
      description: new TranslatableMarkup('Only closed (true) or only open (false) tickets; default both.'),
      required: FALSE,
    ),
    'sort' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Sort'),
      description: new TranslatableMarkup('id (default, oldest first) or -changed (most recently changed first).'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'tickets' => new ListOutputDefinition(
      label: new TranslatableMarkup('Tickets'),
      description: new TranslatableMarkup('The readable tickets of this page.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One ticket.'),
        property_definitions: [
          'id' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The ticket UUID.'),
          ),
          'identifier' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Identifier'),
            description: new TranslatableMarkup('The ticket identifier, e.g. BAKERS-15.'),
          ),
          'title' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Title'),
            description: new TranslatableMarkup('The ticket title.'),
          ),
          'url' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Url'),
            description: new TranslatableMarkup('The absolute canonical ticket URL.'),
          ),
          'origin' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Origin'),
            description: new TranslatableMarkup('The stored origin, null when absent or unreadable.'),
            nullable: TRUE,
          ),
          'state' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('State'),
            description: new TranslatableMarkup('The workflow state id.'),
          ),
          'links' => new ListOutputDefinition(
            label: new TranslatableMarkup('Links'),
            description: new TranslatableMarkup('The ticket links.'),
            item_definition: new MapOutputDefinition(
              label: new TranslatableMarkup('Link'),
              description: new TranslatableMarkup('One link.'),
              property_definitions: [
                'uri' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('URI'),
                  description: new TranslatableMarkup('The link target.'),
                ),
                'title' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Title'),
                  description: new TranslatableMarkup('The link text.'),
                ),
              ],
            ),
          ),
          'labels' => new ListOutputDefinition(
            label: new TranslatableMarkup('Labels'),
            description: new TranslatableMarkup('The label names.'),
            item_definition: new OutputDefinition(
              data_type: 'string',
              label: new TranslatableMarkup('Label'),
              description: new TranslatableMarkup('A label name.'),
            ),
          ),
          'frozen' => new OutputDefinition(
            data_type: 'boolean',
            label: new TranslatableMarkup('Frozen'),
            description: new TranslatableMarkup('Whether the ticket is frozen for a release batch.'),
          ),
          'frozen_at' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Frozen at'),
            description: new TranslatableMarkup('When the ticket was frozen, ISO 8601; null when not frozen.'),
            nullable: TRUE,
          ),
          'parent' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Parent'),
            description: new TranslatableMarkup('The parent ticket’s UUID; null when absent or not readable.'),
            nullable: TRUE,
          ),
          'closed' => new OutputDefinition(
            data_type: 'boolean',
            label: new TranslatableMarkup('Closed'),
            description: new TranslatableMarkup('Whether the ticket is closed.'),
          ),
          'ticket_type' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Ticket type'),
            description: new TranslatableMarkup('The ticket type name, e.g. bug; null when unset.'),
            nullable: TRUE,
          ),
          'changed' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Changed'),
            description: new TranslatableMarkup('When the ticket last changed, ISO 8601.'),
          ),
          'active_run' => new MapOutputDefinition(
            label: new TranslatableMarkup('Active run'),
            description: new TranslatableMarkup('The claimed or running run you can read, null when none.'),
            nullable: TRUE,
            property_definitions: [
              'id' => new OutputDefinition(
                data_type: 'string',
                label: new TranslatableMarkup('UUID'),
                description: new TranslatableMarkup('The run UUID.'),
              ),
              'state' => new OutputDefinition(
                data_type: 'string',
                label: new TranslatableMarkup('State'),
                description: new TranslatableMarkup('claimed or running.'),
              ),
            ],
          ),
        ],
      ),
    ),
    'next_offset' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Next offset'),
      description: new TranslatableMarkup('The offset of the next page, or null on the last page.'),
      nullable: TRUE,
    ),
  ],
)]
final class TicketList extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;
  use PagedQueryTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $project = $this->readableId('bb_project', (string) $values['project'], 'Project');
    $storage = $this->entities()->getStorage('bb_ticket');
    $sort = $values['sort'] ?? 'id';
    if (!in_array($sort, ['id', '-changed'], TRUE)) {
      throw new \InvalidArgumentException('sort must be id or -changed.');
    }
    $query = $storage->getQuery()->accessCheck(TRUE)->condition('project_id', $project);
    if (isset($values['closed'])) {
      $query->condition('closed', (int) (bool) $values['closed']);
    }
    if ($sort === '-changed') {
      $query->sort('changed', 'DESC');
    }
    [$ids, $next] = $this->page($query->sort('id'), $values);
    $page = $storage->loadMultiple($ids);
    $readableParents = $this->readableParents($page);
    $activeRuns = $this->activeRuns($ids);
    $tickets = [];
    foreach ($page as $ticket) {
      assert($ticket instanceof BbTicketInterface);
      $tickets[] = $this->row($ticket, $readableParents) + [
        'ticket_type' => $ticket->get('ticket_type')->entity?->label(),
        'changed' => date('c', (int) $ticket->get('changed')->value),
        'active_run' => $activeRuns[(int) $ticket->id()] ?? NULL,
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count tickets found.', ['@count' => count($tickets)]), [
      'tickets' => $tickets,
      'next_offset' => $next,
    ]);
  }

  /**
   * The parent ids of these tickets that the caller may read.
   *
   * The scoped query is the read boundary, as for the page itself; entity
   * access alone does not apply the caller's project scope.
   *
   * @param array<\Drupal\Core\Entity\EntityInterface> $tickets
   *   The tickets of the page.
   *
   * @return array<int>
   *   The readable parent ids.
   */
  private function readableParents(array $tickets): array {
    $parents = [];
    foreach ($tickets as $ticket) {
      assert($ticket instanceof BbTicketInterface);
      $parent = $ticket->get('parent_id')->target_id;
      if ($parent !== NULL) {
        $parents[] = (int) $parent;
      }
    }
    if (!$parents) {
      return [];
    }
    $readable = $this->entities()->getStorage('bb_ticket')->getQuery()->accessCheck(TRUE)
      ->condition('id', array_unique($parents), 'IN')->execute();
    return array_map('intval', array_values($readable));
  }

  /**
   * The readable claimed or running run of each ticket, from one query.
   *
   * @param array<int|string> $ticketIds
   *   The ticket ids of the page.
   *
   * @return array<int, array{id: string, state: string}>
   *   The active run, keyed by ticket id.
   */
  private function activeRuns(array $ticketIds): array {
    if (!$ticketIds) {
      return [];
    }
    $storage = $this->entities()->getStorage('bb_run');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('ticket_id', $ticketIds, 'IN')
      ->condition('state', ['claimed', 'running'], 'IN')
      ->sort('id')
      ->execute();
    $runs = [];
    foreach ($storage->loadMultiple($ids) as $run) {
      assert($run instanceof BbRunInterface);
      // The newest wins should a ticket ever hold two.
      $runs[(int) $run->getTicketId()] = ['id' => (string) $run->uuid(), 'state' => $run->getRunState()];
    }
    return $runs;
  }

  /**
   * One ticket's row.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param array<int> $readableParents
   *   The parent ids the caller may read.
   *
   * @return array<string, mixed>
   *   The row, keyed by output property.
   */
  private function row(BbTicketInterface $ticket, array $readableParents): array {
    $frozenAt = $ticket->getFrozenAt();
    $parentId = $ticket->get('parent_id')->target_id;
    $parent = $parentId !== NULL && in_array((int) $parentId, $readableParents, TRUE) ? $ticket->get('parent_id')->entity : NULL;
    return [
      'id' => $ticket->uuid(),
      'identifier' => $ticket->getIdentifier(),
      'title' => $ticket->getTitle(),
      'url' => $ticket->toUrl()->setAbsolute()->toString(),
      'origin' => $ticket->get('origin')->access('view', $this->currentUser) ? $ticket->get('origin')->value : NULL,
      'state' => (string) $ticket->get('state')->value,
      'links' => array_map(static fn (array $link): array => [
        'uri' => $link['uri'],
        'title' => (string) $link['title'],
      ], $ticket->get('links')->access('view', $this->currentUser) ? $ticket->get('links')->getValue() : []),
      'labels' => array_map(static fn ($term): string => (string) $term->label(), $ticket->get('labels')->referencedEntities()),
      'frozen' => $ticket->isFrozen(),
      'frozen_at' => $frozenAt === NULL ? NULL : date('c', $frozenAt),
      'parent' => $parent instanceof BbTicketInterface ? $parent->uuid() : NULL,
      'closed' => $ticket->isClosed(),
    ];
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // The access-checked queries in doExecute() narrow to readable rows.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
