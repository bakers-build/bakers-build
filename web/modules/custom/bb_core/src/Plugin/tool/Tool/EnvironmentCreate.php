<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Creates an environment on a project, with the UI add form's access.
 */
#[Tool(
  id: 'bakers_environment_create',
  label: new TranslatableMarkup('Create an environment'),
  description: new TranslatableMarkup('Creates an environment on a project: a name unique in the project, the branch it deploys and its base URL. Needs create bb_environment in the project’s workspace. Afterwards bakers_ticket_update environments_add takes its name. Returns the saved environment.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_project',
  input_definitions: [
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('The project key, e.g. BAKERS, or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'name' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('The environment name, unique in the project, e.g. prod.'),
      constraints: ['NotBlank' => []],
    ),
    'branch' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Branch'),
      description: new TranslatableMarkup('The branch it deploys, e.g. main; a deployment ticket with this environment targets it.'),
      constraints: ['NotBlank' => []],
    ),
    'base_url' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Base URL'),
      description: new TranslatableMarkup('The environment URL.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'uuid' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('UUID'),
      description: new TranslatableMarkup('The environment UUID.'),
    ),
    'name' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('The environment name.'),
    ),
    'branch' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Branch'),
      description: new TranslatableMarkup('The branch it deploys.'),
      nullable: TRUE,
    ),
    'base_url' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Base URL'),
      description: new TranslatableMarkup('The environment URL.'),
      nullable: TRUE,
    ),
    'project' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('The project key.'),
    ),
  ],
)]
final class EnvironmentCreate extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $project = $this->readableProject($values['project']);
    // The add form's _entity_create_access; BbGroupScope on project_id then
    // fences the workspace at validation, as in the form.
    if (!$this->entities()->getAccessControlHandler('bb_environment')->createAccess(NULL, $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('You may not create environments of project %s: it needs create bb_environment, held by workspace leads, or administer bakers.', $project->getKey()));
    }
    $fields = [
      'project_id' => $project->id(),
      'name' => $values['name'],
      'branch' => $values['branch'],
    ];
    if (isset($values['base_url'])) {
      $fields['base_url'] = $values['base_url'];
    }
    $environment = $this->entities()->getStorage('bb_environment')->create($fields);
    assert($environment instanceof BbEnvironmentInterface);
    foreach (array_keys($fields) as $field) {
      if (!$environment->get($field)->access('edit', $this->currentUser)) {
        throw new \InvalidArgumentException(sprintf('You may not set %s of an environment.', $field));
      }
    }
    $this->assertValid($environment);
    $environment->save();
    $saved = $this->entities()->getStorage('bb_environment')->loadUnchanged($environment->id());
    assert($saved instanceof BbEnvironmentInterface);
    return ExecutableResult::success(new TranslatableMarkup('Environment created.'), $this->environmentOutput($saved));
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Create and field access depend on the project; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
