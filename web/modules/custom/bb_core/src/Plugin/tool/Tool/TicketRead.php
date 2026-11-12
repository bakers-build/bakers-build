<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
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
 * Reads one ticket with the comments the caller may see.
 */
#[Tool(
  id: 'bakers_ticket_read',
  label: new TranslatableMarkup('Read a ticket'),
  description: new TranslatableMarkup('Returns a ticket’s fields, labels, links, its newest readable comments in chronological order and facets over all its readable comments.'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'newest' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Newest'),
      description: new TranslatableMarkup('How many of the newest readable comments to return in full, 0 or more; default 2. comment_facets lists all, bakers_comment_read fetches more.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'reviewers' => new ListOutputDefinition(
      label: new TranslatableMarkup('Reviewers'),
      description: new TranslatableMarkup('The readable reviewers.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Reviewer'),
        description: new TranslatableMarkup('The saved account.'),
        property_definitions: [
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The display name.'),
          ),
          'mail' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Mail'),
            description: new TranslatableMarkup('The e-mail address, null without mail view access.'),
            nullable: TRUE,
          ),
        ],
      ),
    ),
    'assignee' => new MapOutputDefinition(
      label: new TranslatableMarkup('Assignee'),
      description: new TranslatableMarkup('The saved account.'),
      nullable: TRUE,
      property_definitions: [
        'name' => new OutputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Name'),
          description: new TranslatableMarkup('The display name.'),
        ),
        'mail' => new OutputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Mail'),
          description: new TranslatableMarkup('The e-mail address, null without mail view access.'),
          nullable: TRUE,
        ),
      ],
    ),

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
    'workflow' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workflow'),
      description: new TranslatableMarkup('The workflow id.'),
    ),
    'description' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('The Markdown description.'),
      constraints: ['MediaType' => ['type' => 'text/markdown']],
      nullable: TRUE,
    ),
    'type' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Type'),
      description: new TranslatableMarkup('The ticket type name.'),
      nullable: TRUE,
    ),
    'recipe' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Recipe'),
      description: new TranslatableMarkup('The recipe name.'),
      nullable: TRUE,
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
    'project' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('The project UUID.'),
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
    'target_branch' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Target branch'),
      description: new TranslatableMarkup('The branch the ticket’s work merges into: a deployment’s environment branch, else the base branch.'),
      nullable: TRUE,
    ),
    'conductor' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Conductor'),
      description: new TranslatableMarkup('The assigned conductor UUID.'),
      nullable: TRUE,
    ),
    'frozen' => new OutputDefinition(
      data_type: 'boolean',
      label: new TranslatableMarkup('Frozen'),
      description: new TranslatableMarkup('Whether the ticket is frozen for a release batch.'),
    ),
    'metrics' => new ListOutputDefinition(
      label: new TranslatableMarkup('Metrics'),
      description: new TranslatableMarkup('The ticket’s metric rows; null when not readable.'),
      nullable: TRUE,
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Metric'),
        description: new TranslatableMarkup('One metric row.'),
        property_definitions: [
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The metric name.'),
          ),
          'value' => new OutputDefinition(
            data_type: 'float',
            label: new TranslatableMarkup('Value'),
            description: new TranslatableMarkup('The numeric value.'),
          ),
          'unit' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Unit'),
            description: new TranslatableMarkup('The unit.'),
            required: FALSE,
            nullable: TRUE,
          ),
        ],
      ),
    ),
    'deployments' => new ListOutputDefinition(
      label: new TranslatableMarkup('Deployments'),
      description: new TranslatableMarkup('The viewable deployment tickets whose referenced tickets contain this ticket, oldest first; empty when none does.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Deployment'),
        description: new TranslatableMarkup('One deployment ticket.'),
        property_definitions: [
          'identifier' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Identifier'),
            description: new TranslatableMarkup('The deployment ticket identifier.'),
          ),
          'environments' => new ListOutputDefinition(
            label: new TranslatableMarkup('Environments'),
            description: new TranslatableMarkup('The environment names the deployment targets.'),
            item_definition: new OutputDefinition(
              data_type: 'string',
              label: new TranslatableMarkup('Environment'),
              description: new TranslatableMarkup('An environment name.'),
            ),
          ),
        ],
      ),
    ),
    'comments' => new ListOutputDefinition(
      label: new TranslatableMarkup('Comments'),
      description: new TranslatableMarkup('The newest readable comments, oldest first.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Comment'),
        description: new TranslatableMarkup('One comment.'),
        property_definitions: [
          'id' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The comment UUID.'),
          ),
          'type' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Type'),
            description: new TranslatableMarkup('The comment type, e.g. plan or spec.'),
          ),
          'body' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Body'),
            description: new TranslatableMarkup('The Markdown body.'),
            constraints: ['MediaType' => ['type' => 'text/markdown']],
          ),
          'created' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Created'),
            description: new TranslatableMarkup('ISO 8601 creation time.'),
          ),
          'author' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Author'),
            description: new TranslatableMarkup('The author’s display name.'),
          ),
        ],
      ),
    ),
    'comment_facets' => new MapOutputDefinition(
      label: new TranslatableMarkup('Comment facets'),
      description: new TranslatableMarkup('Counts over all readable comments, per type and per author.'),
      property_definitions: [
        'type' => new ListOutputDefinition(
          label: new TranslatableMarkup('Type'),
          description: new TranslatableMarkup('One row per comment type, sorted by value.'),
          item_definition: new MapOutputDefinition(
            label: new TranslatableMarkup('Type facet'),
            description: new TranslatableMarkup('The readable comments of one type.'),
            property_definitions: [
              'value' => new OutputDefinition(
                data_type: 'string',
                label: new TranslatableMarkup('Value'),
                description: new TranslatableMarkup('The comment type.'),
              ),
              'count' => new OutputDefinition(
                data_type: 'integer',
                label: new TranslatableMarkup('Count'),
                description: new TranslatableMarkup('How many readable comments have it.'),
              ),
              'newest' => new OutputDefinition(
                data_type: 'string',
                label: new TranslatableMarkup('Newest'),
                description: new TranslatableMarkup('ISO 8601 creation time of the newest of them.'),
              ),
            ],
          ),
        ),
        'author' => new ListOutputDefinition(
          label: new TranslatableMarkup('Author'),
          description: new TranslatableMarkup('One row per comment author, sorted by value.'),
          item_definition: new MapOutputDefinition(
            label: new TranslatableMarkup('Author facet'),
            description: new TranslatableMarkup('The readable comments of one author.'),
            property_definitions: [
              'value' => new OutputDefinition(
                data_type: 'string',
                label: new TranslatableMarkup('Value'),
                description: new TranslatableMarkup('The comment author.'),
              ),
              'count' => new OutputDefinition(
                data_type: 'integer',
                label: new TranslatableMarkup('Count'),
                description: new TranslatableMarkup('How many readable comments have it.'),
              ),
              'newest' => new OutputDefinition(
                data_type: 'string',
                label: new TranslatableMarkup('Newest'),
                description: new TranslatableMarkup('ISO 8601 creation time of the newest of them.'),
              ),
            ],
          ),
        ),
      ],
    ),
  ],
)]
final class TicketRead extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $this->readableTicket($values['ticket']);
    $newest = (int) ($values['newest'] ?? 2);
    if ($newest < 0) {
      throw new \InvalidArgumentException('newest must be 0 or more.');
    }
    $storage = $this->entities()->getStorage('bb_comment');
    $ids = $newest === 0 ? [] : $storage->getQuery()->accessCheck(TRUE)
      ->condition('ticket_id', $ticket->id())
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, $newest)
      ->execute();
    $comments = [];
    foreach (array_reverse($storage->loadMultiple($ids)) as $comment) {
      assert($comment instanceof ContentEntityInterface);
      $comments[] = $this->commentItem($comment);
    }
    return ExecutableResult::success(new TranslatableMarkup('Ticket read.'), [
      'id' => $ticket->uuid(),
      ...$this->ticketPeople($ticket),
      'identifier' => $ticket->getIdentifier(),
      'title' => $ticket->getTitle(),
      'url' => $ticket->toUrl()->setAbsolute()->toString(),
      'origin' => $ticket->get('origin')->access('view', $this->currentUser) ? $ticket->get('origin')->value : NULL,
      'state' => (string) $ticket->get('state')->value,
      'workflow' => $ticket->getWorkflow(),
      'description' => $ticket->get('description')->value,
      'type' => $ticket->get('ticket_type')->entity?->label(),
      'recipe' => $ticket->get('recipe')->entity?->label(),
      'labels' => array_map(static fn ($term): string => (string) $term->label(), $ticket->get('labels')->referencedEntities()),
      'links' => array_map(static fn (array $link): array => [
        'uri' => $link['uri'],
        'title' => (string) $link['title'],
      ], $ticket->get('links')->access('view', $this->currentUser) ? $ticket->get('links')->getValue() : []),
      'project' => $ticket->get('project_id')->entity?->uuid(),
      'branch_name' => $ticket->get('branch_name')->value,
      'base_branch' => $ticket->get('base_branch')->value,
      'target_branch' => $ticket->get('target_branch')->value,
      'conductor' => $ticket->get('conductor_id')->entity?->access('view', $this->currentUser) ? $ticket->get('conductor_id')->entity->uuid() : NULL,
      'frozen' => $ticket->isFrozen(),
      'metrics' => $ticket->get('metrics')->access('view', $this->currentUser) ? array_map(static fn (array $row): array => [
        'name' => $row['name'],
        'value' => (float) $row['value'],
        'unit' => $row['unit'] ?? NULL,
      ], $ticket->get('metrics')->getValue()) : NULL,
      'deployments' => array_map(static fn (BbTicketInterface $deployment): array => [
        'identifier' => $deployment->getIdentifier(),
        'environments' => array_map(static fn ($env): string => (string) $env->label(), $deployment->get('environments')->referencedEntities()),
      ], $ticket->get('deployments')->referencedEntities()),
      'comments' => $comments,
      'comment_facets' => [
        'type' => $this->facet($ticket, 'type', static fn (array $values): array => array_combine($values, array_map(strval(...), $values))),
        'author' => $this->facet($ticket, 'author', fn (array $uids): array => array_map(
          static fn ($user): string => (string) $user->label(),
          $this->entities()->getStorage('user')->loadMultiple($uids),
        )),
      ],
    ]);
  }

  /**
   * Counts the ticket's readable comments per value of one field.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param string $field
   *   The comment field to group by.
   * @param callable(array<int|string>): array<int|string, string> $labels
   *   Maps the stored values to their labels, keyed by stored value.
   *
   * @return list<array{value: string, count: int, newest: string}>
   *   One row per label, sorted by label.
   */
  private function facet(BbTicketInterface $ticket, string $field, callable $labels): array {
    // Aggregates over the access-checked rows only; no body is loaded.
    /** @var list<array<string, int|string>> $groups */
    $groups = $this->entities()->getStorage('bb_comment')->getAggregateQuery()->accessCheck(TRUE)
      ->condition('ticket_id', $ticket->id())
      ->groupBy($field)
      ->aggregate('id', 'COUNT')
      ->aggregate('created', 'MAX')
      ->execute();
    assert(is_array($groups));
    $names = $labels(array_column($groups, $field));
    $rows = [];
    foreach ($groups as $group) {
      $value = $names[$group[$field]] ?? '';
      $rows[$value]['value'] = $value;
      $rows[$value]['count'] = ($rows[$value]['count'] ?? 0) + (int) $group['id_count'];
      $rows[$value]['created'] = max($rows[$value]['created'] ?? 0, (int) $group['created_max']);
    }
    ksort($rows, SORT_STRING);
    return array_values(array_map(static fn (array $row): array => [
      'value' => $row['value'],
      'count' => $row['count'],
      'newest' => date('c', $row['created']),
    ], $rows));
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket and comment access depend on the values; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
