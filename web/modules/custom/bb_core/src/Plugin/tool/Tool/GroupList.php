<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

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
 * Lists the viewable groups of one workspace, or reads back one of them.
 */
#[Tool(
  id: 'bakers_group_list',
  label: new TranslatableMarkup('List groups'),
  description: new TranslatableMarkup('Lists the groups of a workspace by name, or the one group with the given UUID.'),
  operation: ToolOperation::Read,
  permission: 'view bb_group',
  input_definitions: [
    'workspace' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workspace'),
      description: new TranslatableMarkup('Workspace UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'group' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Group'),
      description: new TranslatableMarkup('Group UUID, to read back one group.'),
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
    'groups' => new ListOutputDefinition(
      label: new TranslatableMarkup('Groups'),
      description: new TranslatableMarkup('The viewable groups.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Group'),
        description: new TranslatableMarkup('One group.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The group UUID.'),
          ),
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The group name.'),
          ),
          'description' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Description'),
            description: new TranslatableMarkup('The plain-text description.'),
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
final class GroupList extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;
  use WorkspaceInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $workspace = $this->readableWorkspace($values['workspace']);
    $conditions = empty($values['group']) ? [] : ['uuid' => $values['group']];
    [$entities, $next] = $this->workspacePage('bb_group', $workspace, $conditions, $values);
    $groups = [];
    foreach ($entities as $group) {
      $groups[] = [
        'uuid' => $group->uuid(),
        'name' => (string) $group->label(),
        'description' => $group->get('description')->value,
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count groups found.', ['@count' => count($groups)]), [
      'groups' => $groups,
      'next_offset' => $next,
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // The access-checked queries and entity access in doExecute() decide.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
