<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\TicketWriteBudget;
use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListInputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Drupal\tool\TypedData\MapInputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Changes a ticket's fields, labels and freeze in one save.
 */
#[Tool(
  id: 'bakers_ticket_update',
  label: new TranslatableMarkup('Update a ticket'),
  description: new TranslatableMarkup('Changes an open ticket’s title, description (Markdown, replaced whole), conductor, assignee (a user UUID, empty to clear), labels (added or removed by name, every other one kept), frozen flag, priority (1 High, 2 Medium, 3 Low, 0 to clear; any other value saves nothing), reviewers (added or removed by user UUID), links (upserted by exact URI or removed), environments and referenced tickets (both add-only, existing ones kept), blockers (added or removed by ticket identifier or UUID; an added blocker must be a readable, open ticket of the same project that creates no cycle, else nothing is saved); fields left out keep their values. A closed ticket can no longer be changed. Setting a conductor dispatches a run on the ticket’s current state and fills an empty assignee with the conductor’s owner, also after the assignee is cleared; changing the assignee keeps the conductor. Returns the saved values.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'title' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Title'),
      description: new TranslatableMarkup('The new title, stored verbatim.'),
      required: FALSE,
    ),
    'description' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('The new description as Markdown source; replaces the whole text, empty clears it. Raw HTML is stripped.'),
      required: FALSE,
    ),
    'conductor' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Conductor'),
      description: new TranslatableMarkup('UUID of an active conductor of the ticket’s project.'),
      required: FALSE,
    ),
    'assignee' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Assignee'),
      description: new TranslatableMarkup('UUID of the user to assign, when they may be assigned in the ticket’s workspace; empty clears the assignee. The conductor is kept.'),
      required: FALSE,
    ),
    'labels_add' => new ListInputDefinition(
      label: new TranslatableMarkup('Labels to add'),
      description: new TranslatableMarkup('Label names to add, e.g. agent:claude; created in the ticket’s workspace when missing and allowed. Existing labels are kept.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Label'),
        description: new TranslatableMarkup('One label name.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'labels_remove' => new ListInputDefinition(
      label: new TranslatableMarkup('Labels to remove'),
      description: new TranslatableMarkup('Label names to remove; names the ticket does not carry are ignored. Every other label is kept.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Label'),
        description: new TranslatableMarkup('One label name.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'frozen' => new InputDefinition(
      data_type: 'boolean',
      label: new TranslatableMarkup('Frozen'),
      description: new TranslatableMarkup('TRUE freezes the ticket for a release batch, FALSE unfreezes it.'),
      required: FALSE,
    ),
    'priority' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Priority'),
      description: new TranslatableMarkup('1 High, 2 Medium or 3 Low; 0 clears it. Any other value saves nothing.'),
      required: FALSE,
    ),
    'environments_add' => new ListInputDefinition(
      label: new TranslatableMarkup('Environments to add'),
      description: new TranslatableMarkup('Names or UUIDs of environments of the ticket’s project, e.g. the deployment target. Existing environments are kept.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Environment'),
        description: new TranslatableMarkup('One environment name or UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'referenced_tickets_add' => new ListInputDefinition(
      label: new TranslatableMarkup('Referenced tickets to add'),
      description: new TranslatableMarkup('Identifiers or UUIDs of readable tickets, e.g. a deployment’s batch. Existing references are kept.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One ticket identifier or UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'reviewers_add' => new ListInputDefinition(
      label: new TranslatableMarkup('Reviewers to add'),
      description: new TranslatableMarkup('Reviewer user UUIDs to add; other reviewers stay. Omitted, null and empty lists change nothing.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Reviewer'),
        description: new TranslatableMarkup('One active workspace user’s UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'reviewers_remove' => new ListInputDefinition(
      label: new TranslatableMarkup('Reviewers to remove'),
      description: new TranslatableMarkup('Reviewer user UUIDs to remove; other reviewers stay. Omitted, null and empty lists change nothing.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Reviewer'),
        description: new TranslatableMarkup('One active workspace user’s UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'links_add' => new ListInputDefinition(
      label: new TranslatableMarkup('Links'),
      description: new TranslatableMarkup('Links to add or retitle by exact URI. Omitted title keeps it; empty title clears it. Other links stay.'),
      required: FALSE,
      item_definition: new MapInputDefinition(
        label: new TranslatableMarkup('Link'),
        description: new TranslatableMarkup('One link.'),
        property_definitions: [
          'uri' => new InputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('URI'),
            description: new TranslatableMarkup('The link target, e.g. a merge request URL.'),
            constraints: ['NotBlank' => []],
          ),
          'title' => new InputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Title'),
            description: new TranslatableMarkup('The link text.'),
            required: FALSE,
          ),
        ],
      ),
    ),
    'links_remove' => new ListInputDefinition(
      label: new TranslatableMarkup('Links to remove'),
      description: new TranslatableMarkup('Exact URIs to remove; absent URIs and empty lists change nothing.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('URI'),
        description: new TranslatableMarkup('One stored link URI.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'blocked_by_add' => new ListInputDefinition(
      label: new TranslatableMarkup('Blockers to add'),
      description: new TranslatableMarkup('Identifiers or UUIDs of readable, open tickets of the same project this ticket waits for. Existing blockers are kept; a refused blocker refuses the whole call.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One ticket identifier or UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'blocked_by_remove' => new ListInputDefinition(
      label: new TranslatableMarkup('Blockers to remove'),
      description: new TranslatableMarkup('Identifiers or UUIDs of blockers to remove; tickets that are not blockers are ignored. Every other blocker is kept.'),
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
    'reviewers' => new ListOutputDefinition(
      label: new TranslatableMarkup('Reviewers'),
      description: new TranslatableMarkup('The readable reviewers.'),
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
    'identifier' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Identifier'),
      description: new TranslatableMarkup('The ticket identifier, e.g. BAKERS-15.'),
    ),
    'title' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Title'),
      description: new TranslatableMarkup('The saved title.'),
    ),
    'description' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('The saved description as Markdown source.'),
      nullable: TRUE,
    ),
    'conductor' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Conductor'),
      description: new TranslatableMarkup('The saved conductor UUID.'),
      nullable: TRUE,
    ),
    'labels' => new ListOutputDefinition(
      label: new TranslatableMarkup('Labels'),
      description: new TranslatableMarkup('The saved label names.'),
      item_definition: new OutputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Label'),
        description: new TranslatableMarkup('One label name.'),
      ),
    ),
    'frozen' => new OutputDefinition(
      data_type: 'boolean',
      label: new TranslatableMarkup('Frozen'),
      description: new TranslatableMarkup('Whether the ticket is frozen.'),
    ),
    'priority' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Priority'),
      description: new TranslatableMarkup('1 High, 2 Medium, 3 Low; null for none.'),
      nullable: TRUE,
    ),
    'environments' => new ListOutputDefinition(
      label: new TranslatableMarkup('Environments'),
      description: new TranslatableMarkup('The saved environment names.'),
      item_definition: new OutputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Environment'),
        description: new TranslatableMarkup('One environment name.'),
      ),
    ),
    'referenced_tickets' => new ListOutputDefinition(
      label: new TranslatableMarkup('Referenced tickets'),
      description: new TranslatableMarkup('The saved referenced ticket identifiers.'),
      item_definition: new OutputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Ticket'),
        description: new TranslatableMarkup('One ticket identifier.'),
      ),
    ),
    'links' => new ListOutputDefinition(
      label: new TranslatableMarkup('Links'),
      description: new TranslatableMarkup('The saved links.'),
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
    'blocked_by' => new ListOutputDefinition(
      label: new TranslatableMarkup('Blocked by'),
      description: new TranslatableMarkup('The readable tickets this one waits for; unreadable blockers are omitted.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Blocker'),
        description: new TranslatableMarkup('One blocking ticket.'),
        property_definitions: [
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
            description: new TranslatableMarkup('The ticket’s workflow state id.'),
          ),
        ],
      ),
    ),
  ],
)]
final class TicketUpdate extends ToolBase {

  use TicketInputTrait;

  /**
   * Rolls back a refused update together with labels it created.
   */
  protected Connection $database;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->database = $container->get('database');
    return $instance;
  }

  /**
   * Ticket fields keyed by the input that writes them.
   */
  private const FIELDS = [
    'title' => 'title',
    'description' => 'description',
    'conductor' => 'conductor_id',
    'assignee' => 'assignee_user_id',
    'labels_add' => 'labels',
    'labels_remove' => 'labels',
    'frozen' => 'frozen',
    'priority' => 'priority',
    'environments_add' => 'environments',
    'referenced_tickets_add' => 'referenced_tickets',
    'reviewers_add' => 'reviewers',
    'reviewers_remove' => 'reviewers',
    'links_add' => 'links',
    'links_remove' => 'links',
    'blocked_by_add' => 'blocked_by',
    'blocked_by_remove' => 'blocked_by',
  ];

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    // NULL means absent; an empty string still reaches validation.
    $given = array_filter(
      array_intersect_key($values, self::FIELDS),
      static fn ($value) => $value !== NULL,
    );
    if (!$given) {
      throw new \InvalidArgumentException('Give a title, a description, a conductor, an assignee, labels to add or remove, frozen, a priority, environments to add, referenced tickets to add or blockers to add or remove.');
    }
    $this->assertDisjointLists($given);
    // Closed tickets deny every field edit; say why before the access check.
    if ($this->readableTicket($values['ticket'])->isClosed()) {
      throw new \InvalidArgumentException(sprintf('Ticket %s is closed and can no longer be changed.', $values['ticket']));
    }
    $ticket = $this->writableTicket($values['ticket'], array_values(array_intersect_key(self::FIELDS, $given)));
    if (isset($given['description'])) {
      TicketWriteBudget::check($given['description']);
    }
    // A label created on the way must not outlive a refused update.
    $transaction = $this->database->startTransaction();
    // Inputs with their own handler; the rest replace the value.
    $lists = [
      'assignee' => $this->setAssignee(...),
      'links_add' => $this->addLinks(...),
      'links_remove' => $this->removeLinks(...),
      'reviewers_add' => $this->addReviewers(...),
      'reviewers_remove' => $this->removeReviewers(...),
      'labels_add' => $this->addLabels(...),
      'labels_remove' => $this->removeLabels(...),
      'environments_add' => $this->addEnvironments(...),
      'referenced_tickets_add' => $this->addReferencedTickets(...),
      'blocked_by_add' => $this->addBlockers(...),
      'blocked_by_remove' => $this->removeBlockers(...),
    ];
    try {
      foreach ($given as $input => $value) {
        if (isset($lists[$input])) {
          $lists[$input]($ticket, $value);
          continue;
        }
        $ticket->set(self::FIELDS[$input], match ($input) {
          'description' => ['value' => $value, 'format' => 'bb_rich'],
          'conductor' => $this->conductorId($value),
          'frozen' => (bool) $value,
          'priority' => $this->priority((int) $value, TRUE),
          default => $value,
        });
      }
      $this->assertValid($ticket);
      $ticket->save();
    }
    catch (\Throwable $e) {
      $transaction->rollBack();
      throw $e;
    }
    unset($transaction);
    $saved = $this->entities()->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    assert($saved instanceof BbTicketInterface);
    // BbTicket::preSave() refills a cleared assignee from the conductor.
    $message = ($given['assignee'] ?? NULL) === '' && !$saved->get('assignee_user_id')->isEmpty()
      ? new TranslatableMarkup("Ticket updated; the assignee was refilled from the conductor's owner.")
      : new TranslatableMarkup('Ticket updated.');
    return ExecutableResult::success($message, [
      'links' => array_map(static fn (array $link): array => [
        'uri' => $link['uri'],
        'title' => (string) $link['title'],
      ], $saved->get('links')->access('view', $this->currentUser) ? $saved->get('links')->getValue() : []),
      ...$this->ticketPeople($saved),
      'identifier' => $saved->getIdentifier(),
      'title' => $saved->label(),
      'description' => $saved->get('description')->value,
      'conductor' => $saved->get('conductor_id')->entity?->uuid(),
      'labels' => array_map(static fn ($term) => $term->label(), $saved->get('labels')->referencedEntities()),
      'frozen' => $saved->isFrozen(),
      'priority' => $this->priorityOf($saved),
      'environments' => array_map(static fn ($env) => (string) $env->label(), $saved->get('environments')->referencedEntities()),
      'referenced_tickets' => array_map(static fn (BbTicketInterface $ref) => $ref->getIdentifier(), $saved->getReferencedTickets()),
      'blocked_by' => $this->blockers($saved),
    ]);
  }

  /**
   * Refuses contradictory operations before changing any field.
   *
   * @param array<string, mixed> $given
   *   The supplied update inputs.
   */
  private function assertDisjointLists(array $given): void {
    $both = array_intersect($given['labels_add'] ?? [], $given['labels_remove'] ?? []);
    if ($both) {
      throw new \InvalidArgumentException(sprintf('Label %s is both added and removed.', reset($both)));
    }
    if (array_intersect($given['reviewers_add'] ?? [], $given['reviewers_remove'] ?? [])) {
      throw new \InvalidArgumentException('A reviewer is both added and removed.');
    }
    if (array_intersect(array_column($given['links_add'] ?? [], 'uri'), $given['links_remove'] ?? [])) {
      throw new \InvalidArgumentException('A link URI is both added and removed.');
    }
    // Compare tickets, not strings: an identifier and a UUID may name one.
    if (array_intersect($this->ticketIds($given['blocked_by_add'] ?? []), $this->ticketIds($given['blocked_by_remove'] ?? []))) {
      throw new \InvalidArgumentException('A blocker is both added and removed.');
    }
  }

  /**
   * Assigns an eligible user by UUID, or clears the assignee on empty.
   *
   * The conductor is left alone; BbTicket::preSave() refills an empty
   * assignee from it.
   *
   * @throws \InvalidArgumentException
   */
  private function setAssignee(BbTicketInterface $ticket, string $uuid): void {
    if ($uuid === '') {
      $ticket->set('assignee_user_id', NULL);
    }
    elseif (!$this->assign($ticket, $uuid)) {
      throw new \InvalidArgumentException('No such user can be assigned in this workspace.');
    }
  }

  /**
   * Upserts exact URIs in place; missing title preserves the stored title.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<array{uri: string, title?: string|null}> $links
   *   Links to add or retitle.
   */
  private function addLinks(BbTicketInterface $ticket, array $links): void {
    $stored = $ticket->get('links')->getValue();
    foreach ($links as $link) {
      $index = array_search($link['uri'], array_column($stored, 'uri'), TRUE);
      if ($index === FALSE) {
        $stored[] = ['uri' => $link['uri'], 'title' => $link['title'] ?? ''];
      }
      elseif (isset($link['title'])) {
        $stored[$index]['title'] = $link['title'];
      }
    }
    $ticket->set('links', $stored);
  }

  /**
   * Removes exact URIs, keeping every other link in order.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $uris
   *   Exact link URIs.
   */
  private function removeLinks(BbTicketInterface $ticket, array $uris): void {
    $ticket->get('links')->filter(static fn ($item) => !in_array($item->uri, $uris, TRUE));
  }

  /**
   * Adds reviewers through the same account and field validation as create.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $uuids
   *   Reviewer user UUIDs.
   */
  private function addReviewers(BbTicketInterface $ticket, array $uuids): void {
    foreach (array_unique($uuids) as $uuid) {
      if (!$this->addReviewer($ticket, $uuid)) {
        throw new \InvalidArgumentException('No such user can be a reviewer in this workspace.');
      }
    }
  }

  /**
   * Removes eligible users by UUID, keeping every other reviewer.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $uuids
   *   Reviewer user UUIDs.
   */
  private function removeReviewers(BbTicketInterface $ticket, array $uuids): void {
    foreach (array_unique($uuids) as $uuid) {
      $original = $ticket->get('reviewers')->getValue();
      if (!$this->addReviewer($ticket, $uuid)) {
        throw new \InvalidArgumentException('No such user can be a reviewer in this workspace.');
      }
      $account = $this->activeAccount($uuid);
      assert($account !== NULL);
      $ticket->set('reviewers', $original);
      $ticket->get('reviewers')->filter(static fn ($item) => $item->target_id != $account->id());
    }
  }

  /**
   * Appends the named workspace labels the ticket lacks, keeping the rest.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $names
   *   Label names.
   *
   * @throws \InvalidArgumentException
   */
  private function addLabels(BbTicketInterface $ticket, array $names): void {
    $workspace = $ticket->getProject()?->getGroup()?->getWorkspace();
    $present = array_column($ticket->get('labels')->getValue(), 'target_id');
    foreach (array_unique($names) as $name) {
      $label = $this->term($workspace, 'label', $name);
      if (!in_array($label->id(), $present)) {
        $ticket->get('labels')->appendItem($label->id());
        $present[] = $label->id();
      }
    }
  }

  /**
   * Drops the named labels, keeping every other one in its order.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $names
   *   Label names, resolved like labels_add; absent ones are ignored.
   */
  private function removeLabels(BbTicketInterface $ticket, array $names): void {
    $ids = $this->termIds($ticket->getProject()?->getGroup()?->getWorkspace(), 'label', $names);
    $ticket->get('labels')->filter(static fn ($item) => !in_array($item->target_id, $ids));
  }

  /**
   * Appends the named project environments the ticket lacks, keeping the rest.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $values
   *   Environment names or UUIDs.
   *
   * @throws \InvalidArgumentException
   */
  private function addEnvironments(BbTicketInterface $ticket, array $values): void {
    $storage = $this->entities()->getStorage('bb_environment');
    $present = array_column($ticket->get('environments')->getValue(), 'target_id');
    foreach (array_unique($values) as $value) {
      $ids = $storage->getQuery()
        ->accessCheck(TRUE)
        ->condition('project_id', $ticket->get('project_id')->target_id)
        ->condition(Uuid::isValid($value) ? 'uuid' : 'name', $value)
        ->range(0, 1)
        ->execute();
      if (!$ids) {
        throw new \InvalidArgumentException(sprintf('Environment %s is not one of the project’s environments.', $value));
      }
      $id = reset($ids);
      if (!in_array($id, $present)) {
        $ticket->get('environments')->appendItem($id);
        $present[] = $id;
      }
    }
  }

  /**
   * Appends the readable tickets not referenced yet, keeping the rest.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $values
   *   Ticket identifiers or UUIDs.
   *
   * @throws \InvalidArgumentException
   */
  private function addReferencedTickets(BbTicketInterface $ticket, array $values): void {
    $present = array_column($ticket->get('referenced_tickets')->getValue(), 'target_id');
    foreach (array_unique($values) as $value) {
      $id = $this->readableTicket($value)->id();
      if (!in_array($id, $present)) {
        $ticket->get('referenced_tickets')->appendItem($id);
        $present[] = $id;
      }
    }
  }

  /**
   * Drops the named blockers, keeping every other one in its order.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being changed.
   * @param array<string> $values
   *   Ticket identifiers or UUIDs; unknown or unreadable ones are ignored.
   */
  private function removeBlockers(BbTicketInterface $ticket, array $values): void {
    $ids = $this->ticketIds($values);
    $ticket->get('blocked_by')->filter(static fn ($item) => !in_array((string) $item->target_id, $ids, TRUE));
  }

  /**
   * The ids of the readable tickets with these identifiers or UUIDs.
   *
   * @param array<string> $values
   *   Ticket identifiers or UUIDs.
   *
   * @return array<string>
   *   Ticket ids as strings; unknown values match nothing.
   */
  private function ticketIds(array $values): array {
    if (!$values) {
      return [];
    }
    $query = $this->entities()->getStorage('bb_ticket')->getQuery()->accessCheck(TRUE);
    $uuids = array_values(array_filter($values, Uuid::isValid(...)));
    $identifiers = array_values(array_diff($values, $uuids));
    $match = $query->orConditionGroup();
    if ($uuids) {
      $match->condition('uuid', $uuids, 'IN');
    }
    if ($identifiers) {
      $match->condition('identifier', $identifiers, 'IN');
    }
    return array_map('strval', array_values($query->condition($match)->execute()));
  }

  /**
   * The conductor's id; the ticket's constraints decide whether it fits.
   *
   * @throws \InvalidArgumentException
   */
  private function conductorId(string $uuid): int|string {
    $conductors = $this->entities()->getStorage('bb_conductor')->loadByProperties(['uuid' => $uuid]);
    if (!$conductors) {
      throw new \InvalidArgumentException(sprintf('Conductor %s does not exist.', $uuid));
    }
    return reset($conductors)->id();
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket and field access depend on the values; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
