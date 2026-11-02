<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Access\BbWorkspaceCreateAccess;
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
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Creates a group in one workspace under the scoped create check.
 */
#[Tool(
  id: 'bakers_group_create',
  label: new TranslatableMarkup('Create group'),
  description: new TranslatableMarkup('Creates a group in a workspace and returns it.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'create bb_group',
  input_definitions: [
    'workspace' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Workspace'),
      description: new TranslatableMarkup('Workspace UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'name' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('The group name.'),
      constraints: ['NotBlank' => []],
    ),
    'description' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('Plain text, at most 280 characters.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
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
)]
final class GroupCreate extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;
  use WorkspaceInputTrait;

  /**
   * The web form's rank check in THIS workspace, not the permission union.
   */
  private BbWorkspaceCreateAccess $createAccess;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->createAccess = $container->get('bb_core.workspace_create_access');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $workspace = $this->readableWorkspace($values['workspace']);
    if (!$this->createAccess->check('bb_group', $workspace, $this->currentUser)->isAllowed()) {
      throw new \InvalidArgumentException(sprintf('You may not create groups in workspace %s.', $values['workspace']));
    }
    $fields = ['name' => $values['name'], 'workspace_id' => $workspace->id()];
    if (isset($values['description'])) {
      $fields['description'] = $values['description'];
    }
    $storage = $this->entities()->getStorage('bb_group');
    $group = $storage->create($fields);
    assert($group instanceof ContentEntityInterface);
    foreach (array_keys($fields) as $field) {
      if (!$group->get($field)->access('edit', $this->currentUser)) {
        throw new \InvalidArgumentException(sprintf('You may not set %s of a group.', $field));
      }
    }
    $this->assertValid($group);
    $group->save();
    $stored = $storage->loadUnchanged($group->id());
    assert($stored instanceof ContentEntityInterface);
    return ExecutableResult::success(new TranslatableMarkup('Group created.'), [
      'uuid' => $stored->uuid(),
      'name' => (string) $stored->label(),
      'description' => $stored->get('description')->value,
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Access depends on the workspace; doExecute() checks it.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
