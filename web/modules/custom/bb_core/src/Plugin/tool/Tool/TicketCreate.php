<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\TicketWriteBudget;
use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListInputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Creates a ticket with a Markdown description and its terms by name.
 */
#[Tool(
  id: 'bakers_ticket_create',
  label: new TranslatableMarkup('Create a ticket'),
  description: new TranslatableMarkup('Creates a ticket in a project, in its workflow’s initial state. Type and recipe are term names of the project’s workspace, created there when missing and the caller may. An assignee user UUID assigns that user when they may be assigned in the project’s workspace; otherwise the ticket is created unassigned and the message says so. Each reviewer user UUID adds that user as a reviewer when they may review in the project’s workspace; otherwise it adds no one and the message says so. Each blocker (ticket identifier or UUID) must be a readable, open ticket of the same project; otherwise no ticket is created. Returns the new ticket’s UUID, identifier, state, assignee and reviewers (each with UUID, name and mail) and URL.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_ticket',
  input_definitions: [
    'title' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Title'),
      description: new TranslatableMarkup('The ticket title, stored verbatim.'),
      constraints: ['NotBlank' => []],
    ),
    'workflow' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workflow'),
      description: new TranslatableMarkup('The workflow id, e.g. bb_work.'),
      constraints: ['NotBlank' => []],
    ),
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project identifier prefix (e.g. BAKERS) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'description' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('Markdown source; raw HTML is stripped.'),
      required: FALSE,
      constraints: ['MediaType' => ['type' => 'text/markdown']],
    ),
    'type' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Type'),
      description: new TranslatableMarkup('Ticket type name, e.g. feature or bug.'),
      required: FALSE,
    ),
    'recipe' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Recipe'),
      description: new TranslatableMarkup('Recipe name, e.g. matt.'),
      required: FALSE,
    ),
    'parent' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Parent'),
      description: new TranslatableMarkup('Parent ticket identifier or UUID, in the same project.'),
      required: FALSE,
    ),
    'branch_name' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Branch name'),
      description: new TranslatableMarkup('Git branch for a carrier ticket, e.g. release/1.2; omit to derive it from the identifier and title. Fixed after creation.'),
      required: FALSE,
    ),
    'assignee' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Assignee'),
      description: new TranslatableMarkup('UUID of the user to assign, when they may be assigned in the project’s workspace.'),
      required: FALSE,
    ),
    'reviewers' => new ListInputDefinition(
      label: new TranslatableMarkup('Reviewers'),
      description: new TranslatableMarkup('UUIDs of the users to add as reviewers, each when they may review in the project’s workspace.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Reviewer'),
        description: new TranslatableMarkup('One user UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'blocked_by' => new ListInputDefinition(
      label: new TranslatableMarkup('Blocked by'),
      description: new TranslatableMarkup('Identifiers or UUIDs of readable, open tickets of the same project the new ticket waits for. A refused blocker creates nothing.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One ticket identifier or UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
  ],
  output_definitions: [
    'id' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('UUID'),
      description: new TranslatableMarkup('The new ticket.'),
    ),
    'identifier' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Identifier'),
      description: new TranslatableMarkup('The ticket identifier, e.g. BAKERS-15.'),
      nullable: TRUE,
    ),
    'title' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Title'),
      description: new TranslatableMarkup('The saved ticket title.'),
    ),
    'origin' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Origin'),
      description: new TranslatableMarkup('The stored origin, null when absent or not readable.'),
      nullable: TRUE,
    ),
    'state' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('State'),
      description: new TranslatableMarkup('The initial state id.'),
    ),
    'branch_name' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Branch name'),
      description: new TranslatableMarkup('The ticket’s git branch.'),
      nullable: TRUE,
    ),
    'assignee' => new MapOutputDefinition(
      label: new TranslatableMarkup('Assignee'),
      description: new TranslatableMarkup('The saved account.'),
      nullable: TRUE,
      property_definitions: [
        'uuid' => new OutputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('UUID'),
          description: new TranslatableMarkup('The user UUID.'),
        ),
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
        'service_account' => new OutputDefinition(
          data_type: 'boolean',
          label: new TranslatableMarkup('Service account'),
          description: new TranslatableMarkup('Whether the account is a workspace service account, not a person.'),
        ),
      ],
    ),
    'reviewers' => new ListOutputDefinition(
      label: new TranslatableMarkup('Reviewers'),
      description: new TranslatableMarkup('The readable reviewers added.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Reviewer'),
        description: new TranslatableMarkup('The saved account.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The user UUID.'),
          ),
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
          'service_account' => new OutputDefinition(
            data_type: 'boolean',
            label: new TranslatableMarkup('Service account'),
            description: new TranslatableMarkup('Whether the account is a workspace service account, not a person.'),
          ),
        ],
      ),
    ),
    'url' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('URL'),
      description: new TranslatableMarkup('The ticket’s absolute URL, to link it.'),
    ),
  ],
)]
final class TicketCreate extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    if (!$this->entities()->getAccessControlHandler('bb_ticket')->createAccess('bb_ticket', $this->currentUser)) {
      throw new \InvalidArgumentException('You may not create tickets.');
    }
    $project = $this->readableProject($values['project']);
    TicketWriteBudget::check($values['description'] ?? '');
    $fields = [
      'title' => $values['title'],
      'workflow' => $values['workflow'],
      'project_id' => $project->id(),
      'description' => ['value' => $values['description'] ?? NULL, 'format' => 'bb_rich'],
      'parent_id' => empty($values['parent']) ? NULL : $this->readableTicket($values['parent'])->id(),
    ];
    foreach (array_intersect_key(['type' => 'ticket_type', 'recipe' => 'recipe'], array_filter($values)) as $vid => $field) {
      $fields[$field] = $this->term($project->getGroup()?->getWorkspace(), $vid, $values[$vid])->id();
    }
    if (!empty($values['branch_name'])) {
      $fields['branch_name'] = $values['branch_name'];
    }
    $ticket = $this->entities()->getStorage('bb_ticket')->create($fields);
    assert($ticket instanceof BbTicketInterface);
    if (isset($fields['branch_name']) && !$ticket->get('branch_name')->access('edit', $this->currentUser)) {
      throw new \InvalidArgumentException('You may not set branch_name.');
    }
    $unassigned = !empty($values['assignee']) && !$this->assign($ticket, $values['assignee']);
    $unreviewed = FALSE;
    foreach ($values['reviewers'] ?? [] as $uuid) {
      $unreviewed = !$this->addReviewer($ticket, $uuid) || $unreviewed;
    }
    $this->addBlockers($ticket, $values['blocked_by'] ?? []);
    $this->assertValid($ticket);
    $ticket->save();
    return $this->created($ticket, $unassigned, $unreviewed);
  }

  /**
   * The result for a created ticket.
   *
   * One message for an unknown and an unacceptable user, so the response
   * reveals no account.
   */
  private function created(BbTicketInterface $ticket, bool $unassigned, bool $unreviewed): ExecutableResult {
    $message = $unassigned
      ? new TranslatableMarkup('Ticket created without an assignee: no such user can be assigned in this workspace.')
      : new TranslatableMarkup('Ticket created.');
    if ($unreviewed) {
      $message = new TranslatableMarkup('@created Not every reviewer was added: no such user can be a reviewer in this workspace.', ['@created' => $message]);
    }
    return ExecutableResult::success($message, [
      'id' => $ticket->uuid(),
      'identifier' => $ticket->getIdentifier() ?: NULL,
      'title' => $ticket->label(),
      'origin' => $ticket->get('origin')->access('view', $this->currentUser) ? $ticket->get('origin')->value : NULL,
      'state' => $ticket->get('state')->value,
      'branch_name' => $ticket->get('branch_name')->value,
      ...$this->ticketPeople($ticket),
      'url' => $ticket->toUrl()->setAbsolute()->toString(),
    ]);
  }

  /**
   * The readable project of this key or UUID.
   *
   * @throws \InvalidArgumentException
   */
  private function readableProject(string $project): BbProjectInterface {
    $field = Uuid::isValid($project) ? 'uuid' : 'key';
    $found = $this->entities()->getStorage('bb_project')->loadByProperties([$field => $project]);
    $found = reset($found);
    if (!$found instanceof BbProjectInterface || !$found->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Project %s does not exist or is not readable.', $project));
    }
    return $found;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Access depends on the values; doExecute() checks it.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
