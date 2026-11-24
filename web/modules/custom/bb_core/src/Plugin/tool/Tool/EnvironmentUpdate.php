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
 * Changes a project's environment, with the UI edit form's access.
 */
#[Tool(
  id: 'bakers_environment_update',
  label: new TranslatableMarkup('Update an environment'),
  description: new TranslatableMarkup('Changes a project’s environment, addressed by name or UUID: its name, branch or base URL; keys not given are kept. Needs update bb_environment in the project’s workspace. Returns the saved environment.'),
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
    'environment' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Environment'),
      description: new TranslatableMarkup('The environment name or UUID within the project.'),
      constraints: ['NotBlank' => []],
    ),
    'name' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('The new name, unique in the project.'),
      required: FALSE,
      constraints: ['NotBlank' => []],
    ),
    'branch' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Branch'),
      description: new TranslatableMarkup('The new branch it deploys; a ship ticket with this environment targets it.'),
      required: FALSE,
      constraints: ['NotBlank' => []],
    ),
    'base_url' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Base URL'),
      description: new TranslatableMarkup('The new environment URL.'),
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
final class EnvironmentUpdate extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $project = $this->readableProject($values['project']);
    $environment = $this->readableEnvironment($project, $values['environment']);
    $fields = array_filter(
      array_intersect_key($values, array_flip(['name', 'branch', 'base_url'])),
      static fn ($value) => $value !== NULL,
    );
    $writable = $environment->access('update', $this->currentUser);
    foreach (array_keys($fields) as $field) {
      $writable = $writable && $environment->get($field)->access('edit', $this->currentUser);
    }
    if (!$writable) {
      throw new \InvalidArgumentException(sprintf('You may not change environment %s of project %s: it needs update bb_environment, held by workspace leads, or administer bakers.', $values['environment'], $project->getKey()));
    }
    foreach ($fields as $field => $value) {
      $environment->set($field, $value);
    }
    $this->assertValid($environment);
    $environment->save();
    $saved = $this->entities()->getStorage('bb_environment')->loadUnchanged($environment->id());
    assert($saved instanceof BbEnvironmentInterface);
    return ExecutableResult::success(new TranslatableMarkup('Environment updated.'), $this->environmentOutput($saved));
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Update and field access depend on it; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
