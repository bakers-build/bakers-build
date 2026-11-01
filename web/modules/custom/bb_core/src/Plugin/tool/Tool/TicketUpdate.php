<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
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
 * Changes a ticket's title, description and conductor in one save.
 */
#[Tool(
  id: 'bakers_ticket_update',
  label: new TranslatableMarkup('Update a ticket'),
  description: new TranslatableMarkup('Changes an open ticket’s title, description (Markdown, replaced whole) and/or conductor; fields left out keep their values. Setting a conductor dispatches a run on the ticket’s current state and fills an empty assignee with the conductor’s owner. Returns the saved values.'),
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
  ],
)]
final class TicketUpdate extends ToolBase {

  use TicketInputTrait;

  /**
   * Ticket fields keyed by the input that writes them.
   */
  private const FIELDS = [
    'title' => 'title',
    'description' => 'description',
    'conductor' => 'conductor_id',
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
      throw new \InvalidArgumentException('Give a title, a description or a conductor.');
    }
    // Closed tickets deny every field edit; say why before the access check.
    if ($this->readableTicket($values['ticket'])->isClosed()) {
      throw new \InvalidArgumentException(sprintf('Ticket %s is closed and can no longer be changed.', $values['ticket']));
    }
    $ticket = $this->writableTicket($values['ticket'], array_values(array_intersect_key(self::FIELDS, $given)));
    foreach ($given as $input => $value) {
      $ticket->set(self::FIELDS[$input], match ($input) {
        'description' => ['value' => $value, 'format' => 'bb_rich'],
        'conductor' => $this->conductorId($value),
        default => $value,
      });
    }
    $this->assertValid($ticket);
    $ticket->save();
    $saved = $this->entities()->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    assert($saved instanceof BbTicketInterface);
    return ExecutableResult::success(new TranslatableMarkup('Ticket updated.'), [
      'identifier' => $saved->getIdentifier(),
      'title' => $saved->label(),
      'description' => $saved->get('description')->value,
      'conductor' => $saved->get('conductor_id')->entity?->uuid(),
    ]);
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
