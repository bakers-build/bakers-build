<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
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
 * Finds readable tickets whose title or description contains a text.
 *
 * An access-checked entity query rather than TicketSearchResolver: the
 * resolver needs the Search API index and matches titles only.
 */
#[Tool(
  id: 'bakers_ticket_search',
  label: new TranslatableMarkup('Search tickets'),
  description: new TranslatableMarkup('Finds up to 50 readable tickets whose title or description contains the query, newest first, optionally within one project.'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'query' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Query'),
      description: new TranslatableMarkup('Text to find in ticket titles and descriptions.'),
      constraints: ['NotBlank' => []],
    ),
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project UUID to search within.'),
      required: FALSE,
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
        ],
      ),
    ),
  ],
)]
final class TicketSearch extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $storage = $this->entities()->getStorage('bb_ticket');
    $query = $storage->getQuery()->accessCheck(TRUE)->sort('id', 'DESC')->range(0, 50);
    $query->condition($query->orConditionGroup()
      ->condition('title', $values['query'], 'CONTAINS')
      ->condition('description.value', $values['query'], 'CONTAINS'));
    if (!empty($values['project'])) {
      $projects = $this->entities()->getStorage('bb_project')->getQuery()->accessCheck(TRUE)
        ->condition('uuid', $values['project'])->execute();
      if (!$projects) {
        throw new \InvalidArgumentException(sprintf('Project %s does not exist or is not readable.', $values['project']));
      }
      $query->condition('project_id', reset($projects));
    }
    $tickets = [];
    foreach ($storage->loadMultiple($query->execute()) as $ticket) {
      assert($ticket instanceof BbTicketInterface);
      $tickets[] = [
        'identifier' => $ticket->getIdentifier(),
        'title' => $ticket->getTitle(),
        'state' => (string) $ticket->get('state')->value,
        'type' => $ticket->get('ticket_type')->entity?->label(),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count tickets found.', ['@count' => count($tickets)]), [
      'tickets' => $tickets,
    ]);
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
