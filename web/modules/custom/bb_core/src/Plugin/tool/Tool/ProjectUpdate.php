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
use Drupal\tool\TypedData\MapInputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Changes a project's repository or identifier prefix; group and teams stay.
 */
#[Tool(
  id: 'bakers_project_update',
  label: new TranslatableMarkup('Update a project'),
  description: new TranslatableMarkup('Changes a project’s repository settings or identifier prefix (key); give at least one, the rest is kept. Existing tickets keep their identifier. Needs edit bb_project on the project, or update own bb_project as its owner. Returns the saved project.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_project',
  input_definitions: [
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('The project identifier prefix, e.g. BAKERS, or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'repository' => new MapInputDefinition(
      label: new TranslatableMarkup('Repository'),
      description: new TranslatableMarkup('The repository keys to change; url is required when the project has no repository yet.'),
      required: FALSE,
      property_definitions: [
        'url' => new InputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('URL'),
          description: new TranslatableMarkup('The clone URL, HTTPS or SSH.'),
          required: FALSE,
          constraints: ['NotBlank' => []],
        ),
        'default_branch' => new InputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Default branch'),
          description: new TranslatableMarkup('The branch work bases on, the repository’s integration branch.'),
          required: FALSE,
          constraints: ['NotBlank' => []],
        ),
        'branch_convention' => new InputDefinition(
          data_type: 'string',
          label: new TranslatableMarkup('Branch convention'),
          description: new TranslatableMarkup('The branch naming convention.'),
          required: FALSE,
        ),
      ],
    ),
    'key' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Identifier prefix'),
      description: new TranslatableMarkup('The new identifier prefix, e.g. NEW: 2–10 uppercase letters or digits, starting with a letter. Only tickets created afterwards use it.'),
      required: FALSE,
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
      label: new TranslatableMarkup('Identifier prefix'),
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
          description: new TranslatableMarkup('The branch work bases on.'),
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
final class ProjectUpdate extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $project = $this->readableProject($values['project']);
    $changes = array_filter([
      'repository' => $values['repository'] ?? [],
      'key' => $values['key'] ?? NULL,
    ], static fn (mixed $value): bool => $value !== NULL && $value !== []);
    if ($changes === []) {
      throw new \InvalidArgumentException('Give key or repository.');
    }
    $editable = $project->access('update', $this->currentUser);
    foreach (array_keys($changes) as $field) {
      $editable = $editable && $project->get($field)->access('edit', $this->currentUser);
    }
    if (!$editable) {
      // Roles, not people: naming holders would disclose memberships.
      throw new \InvalidArgumentException(sprintf('You may not edit project %s: it needs edit bb_project, held by team leads, team owners and workspace leads of its workspace, update own bb_project as its owner, or administer bakers.', $project->getKey()));
    }
    if (isset($changes['repository'])) {
      $repository = array_merge($project->get('repository')->first()?->getValue() ?? [], $changes['repository']);
      if (($repository['url'] ?? '') === '') {
        throw new \InvalidArgumentException('repository.url: required, the project has no repository yet.');
      }
      $project->set('repository', $repository);
    }
    if (isset($changes['key'])) {
      $project->set('key', $changes['key']);
    }
    $this->assertValid($project);
    $project->save();
    $saved = $this->entities()->getStorage('bb_project')->loadUnchanged($project->id());
    assert($saved instanceof BbProjectInterface);
    return ExecutableResult::success(new TranslatableMarkup('Project updated.'), $this->projectOutput($saved));
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Update and field access depend on the project; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
