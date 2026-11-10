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
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Lists the viewable conductors of one readable project.
 */
#[Tool(
  id: 'bakers_conductor_list',
  label: new TranslatableMarkup('List conductors'),
  description: new TranslatableMarkup('Lists the conductors of one readable project by label, with whether each is active and online. Assign one to a ticket with bakers_ticket_update.'),
  operation: ToolOperation::Read,
  permission: 'view bb_conductor',
  input_definitions: [
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project key (e.g. BAKERS) or UUID.'),
      constraints: ['NotBlank' => []],
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
    'conductors' => new ListOutputDefinition(
      label: new TranslatableMarkup('Conductors'),
      description: new TranslatableMarkup('The viewable conductors of this page.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Conductor'),
        description: new TranslatableMarkup('One conductor.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The conductor UUID, as bakers_ticket_update takes it.'),
          ),
          'conductor_id' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Conductor ID'),
            description: new TranslatableMarkup('The process registration key.'),
          ),
          'label' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Label'),
            description: new TranslatableMarkup('The conductor label.'),
            nullable: TRUE,
          ),
          'active' => new OutputDefinition(
            data_type: 'boolean',
            label: new TranslatableMarkup('Active'),
            description: new TranslatableMarkup('Whether the conductor can be assigned and claims work.'),
          ),
          'status' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Status'),
            description: new TranslatableMarkup('online or offline.'),
          ),
          'credential_health' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Credential health'),
            description: new TranslatableMarkup('The JSON list of credential checks the conductor last reported (name, status ok|warning|error, expires_at, reason), or null before its first report.'),
            nullable: TRUE,
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
final class ConductorList extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;
  use PagedQueryTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $project = $this->readableProject($values['project']);
    $storage = $this->entities()->getStorage('bb_conductor');
    $query = $storage->getQuery()->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->sort('label')
      ->sort('id');
    [$ids, $next] = $this->page($query, $values);
    $conductors = [];
    foreach ($storage->loadMultiple($ids) as $conductor) {
      assert($conductor instanceof ContentEntityInterface);
      if (!$conductor->access('view', $this->currentUser)) {
        continue;
      }
      $conductors[] = [
        'uuid' => $conductor->uuid(),
        'conductor_id' => (string) $conductor->get('conductor_id')->value,
        'label' => $conductor->get('label')->value,
        'active' => (bool) $conductor->get('active')->value,
        'status' => (string) $conductor->get('status')->value,
        'credential_health' => $conductor->get('credential_health')->value,
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count conductors found.', ['@count' => count($conductors)]), [
      'conductors' => $conductors,
      'next_offset' => $next,
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
