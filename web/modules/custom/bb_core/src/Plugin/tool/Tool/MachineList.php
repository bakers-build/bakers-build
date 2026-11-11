<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Lists the machines the caller may view, with how to reach them.
 */
#[Tool(
  id: 'bakers_machine_list',
  label: new TranslatableMarkup('List machines'),
  description: new TranslatableMarkup('Lists the machines you may view by name, with their machine_id, connection URL and load; narrow to one conductor or one workspace.'),
  operation: ToolOperation::Read,
  permission: 'view bb_machine',
  input_definitions: [
    'workspace' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workspace'),
      description: new TranslatableMarkup('Workspace UUID: only machines with a conductor in that workspace.'),
      required: FALSE,
    ),
    'conductor' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Conductor'),
      description: new TranslatableMarkup("Conductor UUID: only that conductor's machine."),
      required: FALSE,
    ),
    'limit' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Limit'),
      description: new TranslatableMarkup('Rows per page, 1-100; default 50.'),
      required: FALSE,
    ),
    'offset' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Offset'),
      description: new TranslatableMarkup('Rows to skip; default 0.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'machines' => new ListOutputDefinition(
      label: new TranslatableMarkup('Machines'),
      description: new TranslatableMarkup('The viewable machines of this page.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Machine'),
        description: new TranslatableMarkup('One machine.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The machine UUID.'),
          ),
          'machine_id' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Machine ID'),
            description: new TranslatableMarkup('The machine_id (host key), as bakers_conductor_list returns it.'),
          ),
          'label' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Label'),
            description: new TranslatableMarkup('The machine name.'),
            nullable: TRUE,
          ),
          'connection_url' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Connection URL'),
            description: new TranslatableMarkup('How to reach the machine, or null when unset.'),
            nullable: TRUE,
          ),
          'max_parallel' => new OutputDefinition(
            data_type: 'integer',
            label: new TranslatableMarkup('Max parallel'),
            description: new TranslatableMarkup('Runs the machine takes at once.'),
          ),
          'current_load' => new OutputDefinition(
            data_type: 'integer',
            label: new TranslatableMarkup('Current load'),
            description: new TranslatableMarkup('Runs the machine holds now.'),
          ),
        ],
      ),
    ),
    'next_offset' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Next offset'),
      description: new TranslatableMarkup('The offset of the next page, or null on the last page.'),
      nullable: TRUE,
    ),
  ],
)]
final class MachineList extends ToolBase {

  use TicketInputTrait;
  use WorkspaceInputTrait;
  use PagedQueryTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $storage = $this->entities()->getStorage('bb_machine');
    $query = $storage->getQuery()->accessCheck(TRUE)
      ->sort('name')
      ->sort('id');
    if (($values['conductor'] ?? '') !== '') {
      $query->condition('id', $this->machineIds([$this->readableConductor($values['conductor'])]) ?: [0], 'IN');
    }
    if (($values['workspace'] ?? '') !== '') {
      $workspace = $this->readableWorkspace($values['workspace']);
      $conductors = $this->entities()->getStorage('bb_conductor')->loadMultiple(
        $this->entities()->getStorage('bb_conductor')->getQuery()->accessCheck(TRUE)
          ->condition('project_id.entity.group_id.entity.workspace_id', $workspace->id())
          ->exists('machine')
          ->execute(),
      );
      $query->condition('id', $this->machineIds($conductors) ?: [0], 'IN');
    }
    [$ids, $next] = $this->page($query, $values);
    $machines = [];
    foreach ($storage->loadMultiple($ids) as $machine) {
      assert($machine instanceof BbMachineInterface);
      if (!$machine->access('view', $this->currentUser)) {
        continue;
      }
      $machines[] = [
        'uuid' => $machine->uuid(),
        'machine_id' => $machine->getHostKey(),
        'label' => $machine->get('name')->value,
        'connection_url' => $machine->get('connection_url')->value ?: NULL,
        'max_parallel' => $machine->getMaxParallel(),
        'current_load' => $machine->getCurrentLoad(),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count machines found.', ['@count' => count($machines)]), [
      'machines' => $machines,
      'next_offset' => $next,
    ]);
  }

  /**
   * The viewable conductor with the UUID, or an input error naming it.
   *
   * @throws \InvalidArgumentException
   */
  private function readableConductor(string $uuid): BbConductorInterface {
    $storage = $this->entities()->getStorage('bb_conductor');
    $ids = $storage->getQuery()->accessCheck(TRUE)->condition('uuid', $uuid)->range(0, 1)->execute();
    $conductor = $ids ? $storage->load(reset($ids)) : NULL;
    if (!$conductor instanceof BbConductorInterface || !$conductor->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Conductor %s does not exist or is not readable.', $uuid));
    }
    return $conductor;
  }

  /**
   * The machine ids the viewable conductors run on.
   *
   * @param array<\Drupal\Core\Entity\EntityInterface> $conductors
   *   The conductors.
   *
   * @return array<int>
   *   The distinct machine ids.
   */
  private function machineIds(array $conductors): array {
    $ids = [];
    foreach ($conductors as $conductor) {
      if ($conductor instanceof BbConductorInterface && $conductor->access('view', $this->currentUser) && !$conductor->get('machine')->isEmpty()) {
        $ids[] = (int) $conductor->get('machine')->target_id;
      }
    }
    return array_values(array_unique($ids));
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
