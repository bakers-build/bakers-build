<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
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
 * Creates a project in a group for teams of the group's workspace.
 */
#[Tool(
  id: 'bakers_project_create',
  label: new TranslatableMarkup('Create a project'),
  description: new TranslatableMarkup('Creates a project in a group for one or more teams of the same workspace; the key derives from the name and the ticket counter starts at 1. Returns the saved project.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_project',
  input_definitions: [
    'group' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Group'),
      description: new TranslatableMarkup('UUID of the group that owns the project.'),
      constraints: ['NotBlank' => []],
    ),
    'name' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('The project name; the key, e.g. BAKERS, derives from it.'),
      constraints: ['NotBlank' => []],
    ),
    'teams' => new ListInputDefinition(
      label: new TranslatableMarkup('Teams'),
      description: new TranslatableMarkup('UUIDs of the teams the project belongs to, at least one, all of the group’s workspace.'),
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Team'),
        description: new TranslatableMarkup('One team UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'description' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('The description as Markdown source.'),
      required: FALSE,
    ),
    'repository' => new MapInputDefinition(
      label: new TranslatableMarkup('Repository'),
      description: new TranslatableMarkup('The source repository.'),
      required: FALSE,
      property_definitions: [
        'url' => new InputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('URL'),
          description: new TranslatableMarkup('The clone URL, HTTPS or SSH.'),
          constraints: ['NotBlank' => []],
        ),
        'default_branch' => new InputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Default branch'),
          description: new TranslatableMarkup('The branch work bases on; main when omitted.'),
          required: FALSE,
        ),
        'branch_convention' => new InputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Branch convention'),
          description: new TranslatableMarkup('The branch naming convention.'),
          required: FALSE,
        ),
      ],
    ),
    'coder_config' => new InputDefinition(
      data_type: 'map',
      label: new TranslatableMarkup('Coder config'),
      description: new TranslatableMarkup('The coder configuration map, stored as given.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
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
    'description' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Description'),
      description: new TranslatableMarkup('The description as Markdown source.'),
      nullable: TRUE,
    ),
    'group' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Group'),
      description: new TranslatableMarkup('The group UUID.'),
      nullable: TRUE,
    ),
    'teams' => new ListOutputDefinition(
      label: new TranslatableMarkup('Teams'),
      description: new TranslatableMarkup('The UUIDs of the project’s teams.'),
      item_definition: new OutputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Team'),
        description: new TranslatableMarkup('One team UUID.'),
      ),
    ),
    'repository' => new MapOutputDefinition(
      label: new TranslatableMarkup('Repository'),
      description: new TranslatableMarkup('The repository; null when unset or not viewable.'),
      nullable: TRUE,
      property_definitions: [
        'url' => new OutputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('URL'),
          description: new TranslatableMarkup('The clone URL.'),
        ),
        'default_branch' => new OutputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Default branch'),
          description: new TranslatableMarkup('The default branch; null means main.'),
          nullable: TRUE,
        ),
        'branch_convention' => new OutputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Branch convention'),
          description: new TranslatableMarkup('The branch naming convention.'),
          nullable: TRUE,
        ),
      ],
    ),
    'coder_config' => new OutputDefinition(
      data_type: 'map',
      label: new TranslatableMarkup('Coder config'),
      description: new TranslatableMarkup('The coder configuration map; null when unset or not viewable.'),
      nullable: TRUE,
    ),
  ],
)]
final class ProjectCreate extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    if (!$this->entities()->getAccessControlHandler('bb_project')->createAccess('bb_project', $this->currentUser)) {
      throw new \InvalidArgumentException('You may not create projects.');
    }
    $group = $this->entities()->getStorage('bb_group')->load($this->readableId('bb_group', $values['group'], 'Group'));
    assert($group instanceof BbGroupInterface);
    $fields = [
      'group_id' => $group->id(),
      'name' => $values['name'],
      'teams' => $this->teamIds($group, $values['teams'] ?? []),
    ];
    if (isset($values['description'])) {
      $fields['description'] = ['value' => $values['description'], 'format' => 'bb_rich'];
    }
    foreach (['repository', 'coder_config'] as $field) {
      if (isset($values[$field])) {
        $fields[$field] = $values[$field];
      }
    }
    $project = $this->entities()->getStorage('bb_project')->create($fields);
    assert($project instanceof BbProjectInterface);
    foreach (array_keys($fields) as $field) {
      if (!$project->get($field)->access('edit', $this->currentUser)) {
        throw new \InvalidArgumentException(sprintf('You may not set %s of a project.', $field));
      }
    }
    $this->assertValid($project);
    $project->save();
    $saved = $this->entities()->getStorage('bb_project')->loadUnchanged($project->id());
    assert($saved instanceof BbProjectInterface);
    return ExecutableResult::success(new TranslatableMarkup('Project created.'), $this->projectOutput($saved));
  }

  /**
   * The ids of the readable teams, all of the group's workspace.
   *
   * @param \Drupal\bb_core\Entity\BbGroupInterface $group
   *   The owning group.
   * @param array<string> $uuids
   *   Team UUIDs.
   *
   * @return array<int|string>
   *   Team ids.
   *
   * @throws \InvalidArgumentException
   */
  private function teamIds(BbGroupInterface $group, array $uuids): array {
    $ids = [];
    foreach (array_unique($uuids) as $uuid) {
      $team = $this->entities()->getStorage('bb_team')->load($this->readableId('bb_team', $uuid, 'Team'));
      assert($team instanceof BbTeamInterface);
      // BbWorkspaceScope checks membership only; one project, one workspace.
      if ((string) $team->get('workspace_id')->target_id !== (string) $group->get('workspace_id')->target_id) {
        throw new \InvalidArgumentException(sprintf('Team %s is not in the group’s workspace.', $uuid));
      }
      $ids[] = $team->id();
    }
    return $ids;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Create and field access depend on the values; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
