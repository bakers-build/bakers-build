<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Lists readable projects, optionally by workspace, group and name.
 */
#[Tool(
  id: 'bakers_project_list',
  label: new TranslatableMarkup('List projects'),
  description: new TranslatableMarkup('Lists the projects you can read by name, optionally within one workspace and/or group and whose name contains a text.'),
  operation: ToolOperation::Read,
  permission: 'view bb_project',
  input_definitions: [
    'workspace' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workspace'),
      description: new TranslatableMarkup('Workspace UUID to list within.'),
      required: FALSE,
    ),
    'group' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Group'),
      description: new TranslatableMarkup('Group UUID to list within.'),
      required: FALSE,
    ),
    'query' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Query'),
      description: new TranslatableMarkup('Text the project name contains.'),
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
    'projects' => new ListOutputDefinition(
      label: new TranslatableMarkup('Projects'),
      description: new TranslatableMarkup('The readable projects of this page.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Project'),
        description: new TranslatableMarkup('One project.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The project UUID.'),
          ),
          'key' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Key'),
            description: new TranslatableMarkup('The ticket identifier prefix, e.g. BAKERS.'),
          ),
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The project name.'),
          ),
          'group' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Group'),
            description: new TranslatableMarkup('The group UUID.'),
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
final class ProjectList extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;
  use PagedQueryTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $storage = $this->entities()->getStorage('bb_project');
    $query = $storage->getQuery()->accessCheck(TRUE)->sort('name')->sort('id');
    if (!empty($values['workspace'])) {
      $query->condition('group_id.entity:bb_group.workspace_id', $this->readableId('bb_workspace', $values['workspace'], 'Workspace'));
    }
    if (!empty($values['group'])) {
      $query->condition('group_id', $this->readableId('bb_group', $values['group'], 'Group'));
    }
    if (!empty($values['query'])) {
      $query->condition('name', $values['query'], 'CONTAINS');
    }
    [$ids, $next] = $this->page($query, $values);
    $projects = [];
    foreach ($storage->loadMultiple($ids) as $project) {
      assert($project instanceof BbProjectInterface);
      if (!$project->access('view', $this->currentUser)) {
        continue;
      }
      $projects[] = [
        'uuid' => $project->uuid(),
        'key' => $project->getKey(),
        'name' => $project->label(),
        'group' => $project->getGroup()?->uuid(),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count projects found.', ['@count' => count($projects)]), [
      'projects' => $projects,
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
