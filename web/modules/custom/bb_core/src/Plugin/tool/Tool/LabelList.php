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
 * Lists the viewable ticket labels of one workspace.
 */
#[Tool(
  id: 'bakers_label_list',
  label: new TranslatableMarkup('List labels'),
  description: new TranslatableMarkup('Lists the ticket labels of a workspace by name, optionally those containing a text.'),
  operation: ToolOperation::Read,
  permission: 'view bb_term',
  input_definitions: [
    'workspace' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workspace'),
      description: new TranslatableMarkup('Workspace UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'query' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Query'),
      description: new TranslatableMarkup('Text the label name contains.'),
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
    'labels' => new ListOutputDefinition(
      label: new TranslatableMarkup('Labels'),
      description: new TranslatableMarkup('The viewable labels.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Label'),
        description: new TranslatableMarkup('One label.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The label UUID.'),
          ),
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The label name.'),
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
final class LabelList extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;
  use WorkspaceInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $workspace = $this->readableWorkspace($values['workspace']);
    [$entities, $next] = $this->workspacePage('bb_term', $workspace, ['vid' => 'label'], $values);
    $labels = [];
    foreach ($entities as $label) {
      $labels[] = [
        'uuid' => $label->uuid(),
        'name' => (string) $label->label(),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count labels found.', ['@count' => count($labels)]), [
      'labels' => $labels,
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
