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
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Sets a ticket's recipe and type by name in one save.
 */
#[Tool(
  id: 'bakers_ticket_classify',
  label: new TranslatableMarkup('Classify a ticket'),
  description: new TranslatableMarkup('Sets a ticket’s recipe and/or type by term name of its workspace, created there when missing and the caller may. Returns the saved names.'),
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
    'recipe' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Recipe'),
      description: new TranslatableMarkup('Recipe name, e.g. matt.'),
      required: FALSE,
    ),
    'type' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Type'),
      description: new TranslatableMarkup('Ticket type name, e.g. feature or bug.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'type' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Type'),
      description: new TranslatableMarkup('The saved type name.'),
      nullable: TRUE,
    ),
    'recipe' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Recipe'),
      description: new TranslatableMarkup('The saved recipe name.'),
      nullable: TRUE,
    ),
  ],
)]
final class TicketClassify extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $fields = array_intersect_key(['type' => 'ticket_type', 'recipe' => 'recipe'], array_filter($values));
    if (!$fields) {
      throw new \InvalidArgumentException('Give a recipe or a type.');
    }
    $ticket = $this->writableTicket($values['ticket'], array_values($fields));
    $workspace = $ticket->getProject()?->getGroup()?->getWorkspace();
    foreach ($fields as $vid => $field) {
      $ticket->set($field, $this->term($workspace, $vid, $values[$vid])->id());
    }
    $this->assertValid($ticket);
    $ticket->save();
    $saved = $this->entities()->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    assert($saved instanceof ContentEntityInterface);
    return ExecutableResult::success(new TranslatableMarkup('Ticket classified.'), [
      'type' => $saved->get('ticket_type')->entity?->label(),
      'recipe' => $saved->get('recipe')->entity?->label(),
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket and term access depend on the values; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
