<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketFacetSearch;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListInputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapInputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Finds readable tickets by text or branch, or filters and counts them.
 *
 * Text and branch run an access-checked entity query rather than
 * TicketSearchResolver: the resolver needs the Search API index and matches
 * titles only. Filters and facets run on the ticket index, whose word
 * matching would give query a second meaning, so the two never mix.
 */
#[Tool(
  id: 'bakers_ticket_search',
  label: new TranslatableMarkup('Search tickets'),
  description: new TranslatableMarkup('Finds up to 50 readable tickets whose title or description contains the query, or whose branch is exactly branch_name, newest first, optionally within one project. Each row names its branch, base branch and parent. Or, instead of query and branch_name (never together), filters and facets: filters narrow the rows (all must hold) and facets count the matching tickets per conductor, project, state or attention, in all readable projects unless project is given; the response then adds total and facets. Needs me: filters {attention: [review, plan_ready, question], conductor_owner: "me", closed: false}, facets [project, attention].'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'query' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Query'),
      description: new TranslatableMarkup('Text to find in ticket titles and descriptions.'),
      required: FALSE,
    ),
    'branch_name' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Branch name'),
      description: new TranslatableMarkup('Exact git branch of the ticket, e.g. feat/bakers-27-replace-the-pub.'),
      required: FALSE,
    ),
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project UUID to search within.'),
      required: FALSE,
    ),
    'filters' => new MapInputDefinition(
      label: new TranslatableMarkup('Filters'),
      description: new TranslatableMarkup('Narrow the rows and counts; every given key must hold. Not with query or branch_name. An empty list or an unknown value is refused.'),
      required: FALSE,
      property_definitions: [
        'conductor' => new ListInputDefinition(
          label: new TranslatableMarkup('Conductors'),
          description: new TranslatableMarkup('Readable conductor UUIDs; a ticket on any of them matches.'),
          required: FALSE,
          item_definition: new InputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Conductor'),
            description: new TranslatableMarkup('One conductor UUID.'),
          ),
        ),
        'conductor_owner' => new InputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Conductor owner'),
          description: new TranslatableMarkup('Only "me": tickets on conductors the signed-in user owns.'),
          required: FALSE,
        ),
        'state' => new ListInputDefinition(
          label: new TranslatableMarkup('States'),
          description: new TranslatableMarkup('Workflow state ids, e.g. plan or review; any matches.'),
          required: FALSE,
          item_definition: new InputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('State'),
            description: new TranslatableMarkup('One workflow state id.'),
          ),
        ),
        'attention' => new ListInputDefinition(
          label: new TranslatableMarkup('Attention'),
          description: new TranslatableMarkup('Why a ticket needs a person: review (in review), plan_ready (in plan with a plan comment and no claimed or running run), question (frozen with the label Question); any matches. A closed ticket has none.'),
          required: FALSE,
          item_definition: new InputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Attention value'),
            description: new TranslatableMarkup('review, plan_ready or question.'),
          ),
        ),
        'closed' => new InputDefinition(
          data_type: 'boolean',
          label: new TranslatableMarkup('Closed'),
          description: new TranslatableMarkup('Only closed (true) or open (false) tickets.'),
          required: FALSE,
        ),
        'frozen' => new InputDefinition(
          data_type: 'boolean',
          label: new TranslatableMarkup('Frozen'),
          description: new TranslatableMarkup('Only frozen (true) or unfrozen (false) tickets.'),
          required: FALSE,
        ),
      ],
    ),
    'facets' => new ListInputDefinition(
      label: new TranslatableMarkup('Facets'),
      description: new TranslatableMarkup('Count the matching tickets per conductor, project, state or attention. Not with query or branch_name.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Facet'),
        description: new TranslatableMarkup('conductor, project, state or attention.'),
      ),
    ),
  ],
  output_definitions: [
    'tickets' => new ListOutputDefinition(
      label: new TranslatableMarkup('Tickets'),
      description: new TranslatableMarkup('The matching tickets.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One matching ticket.'),
        property_definitions: [
          'identifier' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Identifier'),
            description: new TranslatableMarkup('The ticket identifier.'),
          ),
          'title' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Title'),
            description: new TranslatableMarkup('The ticket title.'),
          ),
          'state' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('State'),
            description: new TranslatableMarkup('The workflow state id.'),
          ),
          'type' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Type'),
            description: new TranslatableMarkup('The ticket type name.'),
            nullable: TRUE,
          ),
          'branch_name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Branch name'),
            description: new TranslatableMarkup('The ticket’s git branch.'),
            nullable: TRUE,
          ),
          'base_branch' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Base branch'),
            description: new TranslatableMarkup('The branch the ticket’s work is based on.'),
            nullable: TRUE,
          ),
          'parent' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Parent'),
            description: new TranslatableMarkup('The parent ticket’s identifier.'),
            nullable: TRUE,
          ),
        ],
      ),
    ),
    'total' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Total'),
      description: new TranslatableMarkup('With filters or facets: every matching ticket, beyond the 50 rows.'),
      required: FALSE,
    ),
    'facets' => new MapOutputDefinition(
      label: new TranslatableMarkup('Facets'),
      description: new TranslatableMarkup('With facets: per asked facet, buckets {value, label, count}, most tickets first; conductor buckets add owner {uuid, name} and machine {uuid, name}, each null when gone or absent. Values are UUIDs for conductor and project, ids for state and attention. A ticket without a conductor or attention forms no bucket.'),
      required: FALSE,
    ),
  ],
)]
final class TicketSearch extends ToolBase {

  use TicketInputTrait;

  /**
   * The index search behind filters and facets.
   */
  protected TicketFacetSearch $facetSearch;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->facetSearch = $container->get('bb_core.ticket_facet_search');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $text = array_keys(array_filter(array_intersect_key($values, ['query' => 1, 'branch_name' => 1])));
    // Given filters or facets count even when empty, never ignored silently.
    $index = array_keys(array_filter(array_intersect_key($values, ['filters' => 1, 'facets' => 1]), fn ($value) => $value !== NULL));
    if ($text && $index) {
      throw new \InvalidArgumentException(sprintf('Give %s or %s, not both: text search and filters run on different searches.', implode(' and ', $text), implode(' and ', $index)));
    }
    if ($index) {
      return $this->indexSearch($values);
    }
    if (!$text) {
      throw new \InvalidArgumentException('Give a query or a branch_name. Or give filters or facets.');
    }
    $storage = $this->entities()->getStorage('bb_ticket');
    $query = $storage->getQuery()->accessCheck(TRUE)->sort('id', 'DESC')->range(0, 50);
    if (!empty($values['query'])) {
      $query->condition($query->orConditionGroup()
        ->condition('title', $values['query'], 'CONTAINS')
        ->condition('description.value', $values['query'], 'CONTAINS'));
    }
    if (!empty($values['branch_name'])) {
      $query->condition('branch_name', $values['branch_name']);
    }
    if (!empty($values['project'])) {
      $query->condition('project_id', $this->projectId($values['project']));
    }
    $tickets = $this->rows($query->execute());
    return ExecutableResult::success(new TranslatableMarkup('@count tickets found.', ['@count' => count($tickets)]), [
      'tickets' => $tickets,
    ]);
  }

  /**
   * Filters and counts on the ticket index.
   *
   * @param array<string, mixed> $values
   *   The tool input.
   */
  private function indexSearch(array $values): ExecutableResult {
    $project = empty($values['project']) ? NULL : $this->projectId($values['project']);
    $result = $this->facetSearch->search($values['filters'] ?? [], $values['facets'] ?? [], $project, $this->currentUser);
    $tickets = $this->rows($result['ids']);
    $message = new TranslatableMarkup('@count of @total tickets.', [
      '@count' => count($tickets),
      '@total' => $result['total'],
    ]);
    return ExecutableResult::success($message, [
      'tickets' => $tickets,
      'total' => $result['total'],
      'facets' => $result['facets'],
    ]);
  }

  /**
   * The id of a readable project, or an input error naming the UUID.
   */
  private function projectId(string $uuid): int {
    $projects = $this->entities()->getStorage('bb_project')->getQuery()->accessCheck(TRUE)
      ->condition('uuid', $uuid)->execute();
    if (!$projects) {
      throw new \InvalidArgumentException(sprintf('Project %s does not exist or is not readable.', $uuid));
    }
    return (int) reset($projects);
  }

  /**
   * The output rows of the tickets, in the given order.
   *
   * @param array<int|string> $ids
   *   Ticket ids.
   *
   * @return list<array<string, mixed>>
   *   One row per ticket.
   */
  private function rows(array $ids): array {
    $tickets = [];
    foreach ($this->entities()->getStorage('bb_ticket')->loadMultiple($ids) as $ticket) {
      assert($ticket instanceof BbTicketInterface);
      $tickets[] = [
        'identifier' => $ticket->getIdentifier(),
        'title' => $ticket->getTitle(),
        'state' => (string) $ticket->get('state')->value,
        'type' => $ticket->get('ticket_type')->entity?->label(),
        'branch_name' => $ticket->get('branch_name')->value,
        'base_branch' => $ticket->get('base_branch')->value,
        // Unreadable parents stay hidden; the base branch still names theirs.
        'parent' => $this->parentIdentifier($ticket),
      ];
    }
    return $tickets;
  }

  /**
   * The parent's identifier when the actor may read the parent.
   */
  private function parentIdentifier(BbTicketInterface $ticket): ?string {
    $parent = $ticket->get('parent_id')->entity;
    return $parent instanceof BbTicketInterface && $parent->access('view', $this->currentUser) ? $parent->getIdentifier() : NULL;
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
