<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\TicketTemplate\TemplateNotFoundException;
use Drupal\bb_core\TicketTemplate\TicketTemplateAccessDeniedException;
use Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator;
use Drupal\bb_core\TicketTemplate\TicketTemplateValidationException;
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
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Creates a ticket from a ticket template; each input overrides one default.
 */
#[Tool(
  id: 'bakers_ticket_template_run',
  label: new TranslatableMarkup('Run a ticket template'),
  description: new TranslatableMarkup('Creates a new ticket from an enabled ticket template. Every call creates a ticket. Each given input replaces the template default; {{date}} and {{month}} in title and description are rendered. A workspace template needs a project. Returns the new ticket’s UUID and identifier.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_ticket_template',
  input_definitions: [
    'template' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Template'),
      description: new TranslatableMarkup('Ticket template UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'title' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Title'),
      description: new TranslatableMarkup('Ticket title; {{date}} and {{month}} are rendered.'),
      required: FALSE,
    ),
    'description' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('Ticket description as Markdown; {{date}} and {{month}} are rendered.'),
      required: FALSE,
    ),
    'workflow' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workflow'),
      description: new TranslatableMarkup('Ticket workflow, e.g. bb_work.'),
      required: FALSE,
    ),
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('UUID of the project to create the ticket in; required for a workspace template.'),
      required: FALSE,
    ),
    'conductor' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Conductor'),
      description: new TranslatableMarkup('UUID of a conductor of the ticket’s project; empty clears the template’s conductor.'),
      required: FALSE,
    ),
    'labels' => new ListInputDefinition(
      label: new TranslatableMarkup('Labels'),
      description: new TranslatableMarkup('Label term UUIDs, replacing the template labels.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Label'),
        description: new TranslatableMarkup('One label term UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'target_state' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Target state'),
      description: new TranslatableMarkup('State the new ticket is moved to; empty keeps the initial state.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'uuid' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('UUID'),
      description: new TranslatableMarkup('The new ticket’s UUID.'),
    ),
    'identifier' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Identifier'),
      description: new TranslatableMarkup('The new ticket’s identifier, e.g. BAKERS-15.'),
    ),
  ],
)]
final class TicketTemplateRun extends ToolBase {

  use TicketInputTrait;

  /**
   * UUID inputs: override key, entity type and the name an error uses.
   */
  private const REFERENCES = [
    'project' => ['project_id', 'bb_project', 'Project'],
    'conductor' => ['conductor_id', 'bb_conductor', 'Conductor'],
  ];

  /**
   * Creates the ticket.
   */
  private TicketTemplateInstantiator $instantiator;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->instantiator = $container->get('bb_core.ticket_template_instantiator');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    // NULL means absent; a present value wins even when empty.
    $overrides = array_filter(
      array_intersect_key($values, array_flip(['title', 'description', 'workflow', 'target_state'])),
      static fn ($value) => $value !== NULL,
    );
    foreach (self::REFERENCES as $input => [$field, $type, $thing]) {
      if (isset($values[$input])) {
        $overrides[$field] = $values[$input] === '' ? NULL : $this->resolve($type, $thing, $values[$input]);
      }
    }
    if (isset($values['labels'])) {
      $overrides['labels'] = array_map(fn (string $uuid) => $this->resolve('bb_term', 'Label', $uuid), $values['labels']);
    }
    try {
      $result = $this->instantiator->instantiate($values['template'], $this->currentUser, $overrides);
    }
    catch (TemplateNotFoundException | TicketTemplateAccessDeniedException | TicketTemplateValidationException $e) {
      throw new \InvalidArgumentException($e->getMessage(), 0, $e);
    }
    return ExecutableResult::success(new TranslatableMarkup('Ticket @identifier created.', ['@identifier' => $result['identifier']]), [
      'uuid' => $result['ticket_uuid'],
      'identifier' => $result['identifier'],
    ]);
  }

  /**
   * The id of the readable entity with this UUID.
   *
   * @throws \InvalidArgumentException
   */
  private function resolve(string $type, string $thing, string $uuid): int|string {
    $ids = $this->entities()->getStorage($type)->getQuery()->accessCheck(TRUE)
      ->condition('uuid', $uuid)->range(0, 1)->execute();
    $entity = $ids ? $this->entities()->getStorage($type)->load(reset($ids)) : NULL;
    if ($entity === NULL || !$entity->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('%s %s does not exist or is not readable.', $thing, $uuid));
    }
    return $entity->id();
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // The instantiator checks template, permission and create access.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
