<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
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
  description: new TranslatableMarkup('Returns a ticket’s fields, labels, links and its readable comments in chronological order.'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
  ],
  output_definitions: [
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
    'approval' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Approval'),
      description: new TranslatableMarkup("Who approves the current state's gates: automatic or human."),
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
    'comments' => new ListOutputDefinition(
      label: new TranslatableMarkup('Comments'),
      description: new TranslatableMarkup('The readable comments, oldest first.'),
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
  ],
)]
final class TicketRead extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $this->readableTicket($values['ticket']);
    $storage = $this->entities()->getStorage('bb_comment');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('ticket_id', $ticket->id())
      ->sort('created')
      ->sort('id')
      ->execute();
    $comments = [];
    foreach ($storage->loadMultiple($ids) as $comment) {
      assert($comment instanceof ContentEntityInterface);
      $comments[] = [
        'id' => $comment->uuid(),
        'type' => (string) $comment->get('type')->value,
        'body' => (string) $comment->get('body')->value,
        'created' => date('c', (int) $comment->get('created')->value),
        'author' => (string) $comment->get('author')->entity?->label(),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('Ticket read.'), [
      'id' => $ticket->uuid(),
      'identifier' => $ticket->getIdentifier(),
      'title' => $ticket->getTitle(),
      'state' => (string) $ticket->get('state')->value,
      'workflow' => $ticket->getWorkflow(),
      'approval' => TypeWorkflows::approval($ticket->getWorkflow(), (string) $ticket->get('state')->value),
      'description' => $ticket->get('description')->value,
      'type' => $ticket->get('ticket_type')->entity?->label(),
      'recipe' => $ticket->get('recipe')->entity?->label(),
      'labels' => array_map(static fn ($term): string => (string) $term->label(), $ticket->get('labels')->referencedEntities()),
      'links' => array_map(static fn (array $link): array => [
        'uri' => $link['uri'],
        'title' => (string) $link['title'],
      ], $ticket->get('links')->getValue()),
      'project' => $ticket->get('project_id')->entity?->uuid(),
      'branch_name' => $ticket->get('branch_name')->value,
      'base_branch' => $ticket->get('base_branch')->value,
      'conductor' => $ticket->get('conductor_id')->entity?->access('view', $this->currentUser) ? $ticket->get('conductor_id')->entity->uuid() : NULL,
      'frozen' => $ticket->isFrozen(),
      'metrics' => $ticket->get('metrics')->access('view', $this->currentUser) ? array_map(static fn (array $row): array => [
        'name' => $row['name'],
        'value' => (float) $row['value'],
        'unit' => $row['unit'] ?? NULL,
      ], $ticket->get('metrics')->getValue()) : NULL,
      'comments' => $comments,
    ]);
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
