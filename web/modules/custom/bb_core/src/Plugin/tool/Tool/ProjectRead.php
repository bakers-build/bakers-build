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
 * Reads one project; its environment variables never leave the server here.
 */
#[Tool(
  id: 'bakers_project_read',
  label: new TranslatableMarkup('Read a project'),
  description: new TranslatableMarkup('Returns one readable project by key or UUID: name, description, group, teams, repository, coder config and its viewable environments (name, branch, base URL); bakers_ticket_update environments_add takes such a name. Environment variables are never returned.'),
  operation: ToolOperation::Read,
  permission: 'view bb_project',
  input_definitions: [
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project key (e.g. BAKERS) or UUID.'),
      constraints: ['NotBlank' => []],
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
    'environments' => new ListOutputDefinition(
      label: new TranslatableMarkup('Environments'),
      description: new TranslatableMarkup('The project’s environments the caller may view, by name.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Environment'),
        description: new TranslatableMarkup('One environment.'),
        property_definitions: [
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The environment name.'),
          ),
          'branch' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Branch'),
            description: new TranslatableMarkup('The branch it deploys; a ticket with this environment targets it.'),
            nullable: TRUE,
          ),
          'base_url' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Base URL'),
            description: new TranslatableMarkup('The environment URL.'),
            nullable: TRUE,
          ),
        ],
      ),
    ),
  ],
)]
final class ProjectRead extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $project = $this->readableProject($values['project']);
    $field = $project->get('environments');
    $environments = array_filter(
      $field->access('view', $this->currentUser) ? $field->referencedEntities() : [],
      fn ($environment) => $environment->access('view', $this->currentUser),
    );
    return ExecutableResult::success(new TranslatableMarkup('Project read.'), $this->projectOutput($project) + [
      'environments' => array_values(array_map(static fn ($environment) => [
        'name' => (string) $environment->label(),
        'branch' => $environment->get('branch')->value,
        'base_url' => $environment->get('base_url')->value,
      ], $environments)),
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
