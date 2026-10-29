<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

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
use Drupal\tool\TypedData\ListInputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapInputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Moves a ticket to a workflow state and appends links in one save.
 */
#[Tool(
  id: 'bakers_ticket_transition',
  label: new TranslatableMarkup('Transition a ticket'),
  description: new TranslatableMarkup('Moves a ticket to the target state when its workflow allows it, appending the given links to the existing ones; without a state it only appends the links. Returns the saved state and links.'),
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
    'state' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Target state'),
      description: new TranslatableMarkup('The workflow state id to move to, e.g. working or review; omit to only append links.'),
      required: FALSE,
    ),
    'links' => new ListInputDefinition(
      label: new TranslatableMarkup('Links'),
      description: new TranslatableMarkup('Links to add; existing links are kept and duplicates merged.'),
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
  ],
  output_definitions: [
    'state' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('State'),
      description: new TranslatableMarkup('The saved state id.'),
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
  ],
)]
final class TicketTransition extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $target = $values['state'] ?? '';
    if ($target === '' && empty($values['links'])) {
      throw new \InvalidArgumentException('Give a target state or links to add.');
    }
    $ticket = $this->writableTicket($values['ticket'], $target === '' ? ['links'] : ['state', 'links']);
    if ($target !== '') {
      $state = $ticket->getState();
      $transition = NULL;
      foreach ($state->getTransitions() as $candidate) {
        if ($candidate->getToState()->getId() === $target) {
          $transition = $candidate;
          break;
        }
      }
      if ($transition === NULL) {
        throw new \InvalidArgumentException(sprintf('Ticket %s cannot move from %s to %s.', $values['ticket'], $state->getId(), $target));
      }
      $state->applyTransition($transition);
    }
    foreach ($values['links'] ?? [] as $link) {
      $ticket->get('links')->appendItem(['uri' => $link['uri'], 'title' => $link['title'] ?? '']);
    }
    $this->assertValid($ticket);
    $ticket->save();
    $saved = $this->entities()->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    assert($saved instanceof ContentEntityInterface);
    return ExecutableResult::success(new TranslatableMarkup('Ticket transitioned.'), [
      'state' => $saved->get('state')->value,
      'links' => array_map(static fn (array $link): array => [
        'uri' => $link['uri'],
        'title' => (string) $link['title'],
      ], $saved->get('links')->getValue()),
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket access depends on the values; doExecute() checks it.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
