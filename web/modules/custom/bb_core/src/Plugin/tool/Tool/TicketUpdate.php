<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
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
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Changes a ticket's fields, labels and freeze in one save.
 */
#[Tool(
  id: 'bakers_ticket_update',
  label: new TranslatableMarkup('Update a ticket'),
  description: new TranslatableMarkup('Changes an open ticket’s title, description (Markdown, replaced whole), conductor, labels (added or removed by name, every other one kept), frozen flag, environments and referenced tickets (both add-only, existing ones kept); fields left out keep their values. A closed ticket only takes environments_add, so a deployment can stamp its batch. Setting a conductor dispatches a run on the ticket’s current state and fills an empty assignee with the conductor’s owner. Returns the saved values.'),
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
    'environments_add' => new ListInputDefinition(
      label: new TranslatableMarkup('Environments to add'),
      description: new TranslatableMarkup('Names or UUIDs of environments of the ticket’s project, e.g. the deployment target. Existing environments are kept; also allowed on a closed ticket.'),
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
  ],
  output_definitions: [
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
  ],
)]
final class TicketUpdate extends ToolBase {

  use TicketInputTrait;

  /**
   * Rolls back a refused update together with labels it created.
   */
  private Connection $database;

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
    'labels_add' => 'labels',
    'labels_remove' => 'labels',
    'frozen' => 'frozen',
    'environments_add' => 'environments',
    'referenced_tickets_add' => 'referenced_tickets',
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
      throw new \InvalidArgumentException('Give a title, a description, a conductor, labels to add or remove, frozen, environments to add or referenced tickets to add.');
    }
    $both = array_intersect($given['labels_add'] ?? [], $given['labels_remove'] ?? []);
    if ($both) {
      throw new \InvalidArgumentException(sprintf('Label %s is both added and removed.', reset($both)));
    }
    // Closed tickets deny every field edit but environments; say why before
    // the access check.
    if (array_keys($given) !== ['environments_add'] && $this->readableTicket($values['ticket'])->isClosed()) {
      throw new \InvalidArgumentException(sprintf('Ticket %s is closed and can no longer be changed.', $values['ticket']));
    }
    $ticket = $this->writableTicket($values['ticket'], array_values(array_intersect_key(self::FIELDS, $given)));
    // A label created on the way must not outlive a refused update.
    $transaction = $this->database->startTransaction();
    // List inputs change their field in place; the rest replace the value.
    $lists = [
      'labels_add' => $this->addLabels(...),
      'labels_remove' => $this->removeLabels(...),
      'environments_add' => $this->addEnvironments(...),
      'referenced_tickets_add' => $this->addReferencedTickets(...),
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
    return ExecutableResult::success(new TranslatableMarkup('Ticket updated.'), [
      'identifier' => $saved->getIdentifier(),
      'title' => $saved->label(),
      'description' => $saved->get('description')->value,
      'conductor' => $saved->get('conductor_id')->entity?->uuid(),
      'labels' => array_map(static fn ($term) => $term->label(), $saved->get('labels')->referencedEntities()),
      'frozen' => $saved->isFrozen(),
      'environments' => array_map(static fn ($env) => (string) $env->label(), $saved->get('environments')->referencedEntities()),
      'referenced_tickets' => array_map(static fn (BbTicketInterface $ref) => $ref->getIdentifier(), $saved->getReferencedTickets()),
    ]);
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
