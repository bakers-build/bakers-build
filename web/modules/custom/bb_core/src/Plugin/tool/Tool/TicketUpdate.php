<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
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
  description: new TranslatableMarkup('Changes an open ticket’s title, description (Markdown, replaced whole), conductor, labels (added by name, existing ones kept) and/or frozen flag; fields left out keep their values. Setting a conductor dispatches a run on the ticket’s current state and fills an empty assignee with the conductor’s owner. Returns the saved values.'),
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
    'frozen' => new InputDefinition(
      data_type: 'boolean',
      label: new TranslatableMarkup('Frozen'),
      description: new TranslatableMarkup('TRUE freezes the ticket for a release batch, FALSE unfreezes it.'),
      required: FALSE,
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
    'frozen' => 'frozen',
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
      throw new \InvalidArgumentException('Give a title, a description, a conductor, labels to add or frozen.');
    }
    // Closed tickets deny every field edit; say why before the access check.
    if ($this->readableTicket($values['ticket'])->isClosed()) {
      throw new \InvalidArgumentException(sprintf('Ticket %s is closed and can no longer be changed.', $values['ticket']));
    }
    $ticket = $this->writableTicket($values['ticket'], array_values(array_intersect_key(self::FIELDS, $given)));
    // A label created on the way must not outlive a refused update.
    $transaction = $this->database->startTransaction();
    try {
      foreach ($given as $input => $value) {
        if ($input === 'labels_add') {
          $this->addLabels($ticket, $value);
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
