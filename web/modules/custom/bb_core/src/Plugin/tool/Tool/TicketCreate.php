<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
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
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Creates a ticket with a Markdown description and its terms by name.
 */
#[Tool(
  id: 'bakers_ticket_create',
  label: new TranslatableMarkup('Create a ticket'),
  description: new TranslatableMarkup('Creates a ticket in a project, in its workflow’s initial state. Type and recipe are term names of the project’s workspace, created there when missing and the caller may. An assignee e-mail address assigns that account when it may be assigned in the project’s workspace; otherwise the ticket is created unassigned and the message says so. Returns the new ticket’s UUID, identifier, state, assignee and URL.'),
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
      description: new TranslatableMarkup('Project key (e.g. BAKERS) or UUID.'),
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
    'assignee_email' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Assignee e-mail address'),
      description: new TranslatableMarkup('E-mail address of the account to assign, when it may be assigned in the project’s workspace.'),
      required: FALSE,
      constraints: ['Email' => []],
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
    'assignee' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Assignee'),
      description: new TranslatableMarkup('The assignee’s display name, or none.'),
      nullable: TRUE,
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
    $unassigned = !empty($values['assignee_email']) && !$this->assign($ticket, $values['assignee_email']);
    $this->assertValid($ticket);
    $ticket->save();
    return $this->created($ticket, $unassigned);
  }

  /**
   * The result for a created ticket.
   *
   * One message for an unknown and an unassignable address, so the response
   * reveals no account.
   */
  private function created(BbTicketInterface $ticket, bool $unassigned): ExecutableResult {
    $message = $unassigned
      ? new TranslatableMarkup('Ticket created without an assignee: no account with this e-mail address can be assigned in this workspace.')
      : new TranslatableMarkup('Ticket created.');
    $assignee = $ticket->get('assignee_user_id')->entity;
    return ExecutableResult::success($message, [
      'id' => $ticket->uuid(),
      'identifier' => $ticket->getIdentifier() ?: NULL,
      'state' => $ticket->get('state')->value,
      'branch_name' => $ticket->get('branch_name')->value,
      'assignee' => $assignee instanceof AccountInterface ? $assignee->getDisplayName() : NULL,
      'url' => $ticket->toUrl()->setAbsolute()->toString(),
    ]);
  }

  /**
   * Assigns the active account of this address when the field's rule allows.
   *
   * The assignee field's own validation (ValidReference with its selection
   * handler) decides, as in the web form. Returns whether it was assigned.
   */
  private function assign(BbTicketInterface $ticket, string $email): bool {
    $storage = $this->entities()->getStorage('user');
    // Case-insensitive, like core's unique-mail check; escaped as escapeLike().
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('mail', addcslashes($email, '\\%_'), 'LIKE')
      ->condition('status', 1)
      ->range(0, 1)
      ->execute();
    $account = $ids ? $storage->load(reset($ids)) : NULL;
    if (!$account instanceof AccountInterface) {
      return FALSE;
    }
    $ticket->set('assignee_user_id', $account->id());
    if ($ticket->get('assignee_user_id')->validate()->count() === 0) {
      return TRUE;
    }
    $ticket->set('assignee_user_id', NULL);
    return FALSE;
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
