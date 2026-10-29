<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
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
 * Writes one measurement's rows into a ticket's metrics.
 */
#[Tool(
  id: 'bakers_metric_write',
  label: new TranslatableMarkup('Record a measurement'),
  description: new TranslatableMarkup('Replaces the ticket’s metric rows whose name starts with the definition name and a dot with the given rows, keeping every other row and label, and optionally adds a label by name (created in the ticket’s workspace when missing).'),
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
    'name' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Measurement'),
      description: new TranslatableMarkup('The measurement definition id, e.g. review_quality; every row name starts with it and a dot.'),
      constraints: ['NotBlank' => [], 'Regex' => ['pattern' => '/^[a-z0-9_]+$/']],
    ),
    'rows' => new ListInputDefinition(
      label: new TranslatableMarkup('Rows'),
      description: new TranslatableMarkup('The measurement’s metric rows.'),
      constraints: ['NotBlank' => []],
      item_definition: new MapInputDefinition(
        label: new TranslatableMarkup('Row'),
        description: new TranslatableMarkup('One metric row.'),
        property_definitions: [
          'name' => new InputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The metric name, e.g. review_quality.score.'),
            constraints: ['NotBlank' => [], 'Length' => ['max' => 64]],
          ),
          'value' => new InputDefinition(
            data_type: 'float',
            label: new TranslatableMarkup('Value'),
            description: new TranslatableMarkup('The numeric value.'),
          ),
          'unit' => new InputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Unit'),
            description: new TranslatableMarkup('The unit, e.g. ratio or hours.'),
            required: FALSE,
            constraints: ['Length' => ['max' => 32]],
          ),
        ],
      ),
    ),
    'label' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Label'),
      description: new TranslatableMarkup('A label name to add to the ticket, e.g. retro.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'metrics' => new ListOutputDefinition(
      label: new TranslatableMarkup('Metrics'),
      description: new TranslatableMarkup('Every metric row of the ticket after the write.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Metric'),
        description: new TranslatableMarkup('One metric row.'),
        property_definitions: [
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The metric name.'),
          ),
          'value' => new OutputDefinition(
            data_type: 'float',
            label: new TranslatableMarkup('Value'),
            description: new TranslatableMarkup('The numeric value.'),
          ),
          'unit' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Unit'),
            description: new TranslatableMarkup('The unit.'),
            required: FALSE,
          ),
        ],
      ),
    ),
  ],
)]
final class MetricWrite extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $prefix = $values['name'] . '.';
    foreach ($values['rows'] as $row) {
      if (!str_starts_with($row['name'], $prefix)) {
        throw new \InvalidArgumentException(sprintf('Row %s is not in the %s namespace.', $row['name'], $prefix));
      }
    }
    $fields = empty($values['label']) ? ['metrics'] : ['metrics', 'labels'];
    $ticket = $this->writableTicket($values['ticket'], $fields);
    $metrics = array_filter($ticket->get('metrics')->getValue(), static fn (array $row): bool => !str_starts_with((string) $row['name'], $prefix));
    foreach ($values['rows'] as $row) {
      $metrics[] = ['name' => $row['name'], 'value' => (string) $row['value'], 'unit' => $row['unit'] ?? NULL];
    }
    $ticket->set('metrics', array_values($metrics));
    if (!empty($values['label'])) {
      $label = $this->label($ticket, $values['label']);
      if (!in_array($label->id(), array_column($ticket->get('labels')->getValue(), 'target_id'))) {
        $ticket->get('labels')->appendItem($label->id());
      }
    }
    $this->assertValid($ticket);
    $ticket->save();
    $saved = $this->entities()->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    assert($saved instanceof ContentEntityInterface);
    return ExecutableResult::success(new TranslatableMarkup('Measurement recorded.'), [
      'metrics' => array_map(static fn (array $row): array => [
        'name' => $row['name'],
        'value' => (float) $row['value'],
        'unit' => $row['unit'] ?? NULL,
      ], $saved->get('metrics')->getValue()),
    ]);
  }

  /**
   * The label term of this name in the ticket's workspace, created if missing.
   *
   * Server side of the CLI's `label_names`: scoped to the ticket's workspace
   * and created there on first use.
   *
   * @throws \InvalidArgumentException
   */
  private function label(BbTicketInterface $ticket, string $name): ContentEntityInterface {
    $workspace = $ticket->getProject()?->getGroup()?->getWorkspace();
    $storage = $this->entities()->getStorage('bb_term');
    $ids = $workspace === NULL ? [] : $storage->getQuery()->accessCheck(TRUE)
      ->condition('vid', 'label')
      ->condition('name', $name)
      ->condition('workspace_id', $workspace->id())
      ->range(0, 1)
      ->execute();
    if ($ids) {
      $term = $storage->load(reset($ids));
      assert($term instanceof ContentEntityInterface);
      return $term;
    }
    if ($workspace === NULL || !$this->entities()->getAccessControlHandler('bb_term')->createAccess('label', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Label %s does not exist and you may not create it.', $name));
    }
    $term = $storage->create(['vid' => 'label', 'name' => $name, 'workspace_id' => $workspace->id()]);
    assert($term instanceof ContentEntityInterface);
    $this->assertValid($term);
    $term->save();
    return $term;
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
