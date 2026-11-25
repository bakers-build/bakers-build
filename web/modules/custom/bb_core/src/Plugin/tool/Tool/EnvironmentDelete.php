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
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Removes a project's environment, with the UI delete form's access.
 */
#[Tool(
  id: 'bakers_environment_delete',
  label: new TranslatableMarkup('Delete an environment'),
  description: new TranslatableMarkup('Removes a project’s environment, addressed by name or UUID; tickets that referenced it keep everything else. Needs delete bb_environment in the project’s workspace. Returns the removed environment’s UUID and name.'),
  operation: ToolOperation::Write,
  destructive: TRUE,
  permission: 'view bb_project',
  input_definitions: [
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('The project identifier prefix, e.g. BAKERS, or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'environment' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Environment'),
      description: new TranslatableMarkup('The environment name or UUID within the project.'),
      constraints: ['NotBlank' => []],
    ),
  ],
  output_definitions: [
    'uuid' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('UUID'),
      description: new TranslatableMarkup('The removed environment’s UUID.'),
    ),
    'name' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('The removed environment’s name.'),
    ),
  ],
)]
final class EnvironmentDelete extends ToolBase {

  use TicketInputTrait;
  use ProjectInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $project = $this->readableProject($values['project']);
    $environment = $this->readableEnvironment($project, $values['environment']);
    if (!$environment->access('delete', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('You may not remove environment %s of project %s: it needs delete bb_environment, held by workspace leads, or administer bakers.', $values['environment'], $project->getKey()));
    }
    $output = ['uuid' => $environment->uuid(), 'name' => (string) $environment->label()];
    // EntityDeleteRules detaches tickets' references, as in the UI delete.
    $environment->delete();
    return ExecutableResult::success(new TranslatableMarkup('Environment deleted.'), $output);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Delete access depends on the environment; doExecute() checks it.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
