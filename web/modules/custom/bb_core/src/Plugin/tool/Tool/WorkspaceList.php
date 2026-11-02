<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbWorkspaceInterface;
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
 * Lists the workspaces the account can view; needs no chosen workspace.
 */
#[Tool(
  id: 'bakers_workspace_list',
  label: new TranslatableMarkup('List workspaces'),
  description: new TranslatableMarkup('Lists the workspaces you can view, by name.'),
  operation: ToolOperation::Read,
  permission: 'view bb_workspace',
  input_definitions: [
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
    'workspaces' => new ListOutputDefinition(
      label: new TranslatableMarkup('Workspaces'),
      description: new TranslatableMarkup('The viewable workspaces.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Workspace'),
        description: new TranslatableMarkup('One workspace.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The workspace UUID.'),
          ),
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The workspace name.'),
          ),
          'slug' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Slug'),
            description: new TranslatableMarkup('The workspace URL slug.'),
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
final class WorkspaceList extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $storage = $this->entities()->getStorage('bb_workspace');
    [$ids, $next] = $this->page($storage->getQuery()->accessCheck(TRUE)->sort('name')->sort('id'), $values);
    $workspaces = [];
    foreach ($storage->loadMultiple($ids) as $workspace) {
      assert($workspace instanceof BbWorkspaceInterface);
      if ($workspace->access('view', $this->currentUser)) {
        $workspaces[] = [
          'uuid' => $workspace->uuid(),
          'name' => (string) $workspace->label(),
          'slug' => (string) $workspace->get('slug')->value,
        ];
      }
    }
    return ExecutableResult::success(new TranslatableMarkup('@count workspaces found.', ['@count' => count($workspaces)]), [
      'workspaces' => $workspaces,
      'next_offset' => $next,
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // The access-checked query and entity access in doExecute() decide.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
