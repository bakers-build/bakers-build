<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
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
 * Deletes one of the caller's recorded or proposed worklogs.
 */
#[Tool(
  id: 'bakers_worklog_delete',
  label: new TranslatableMarkup('Delete own worklog'),
  description: new TranslatableMarkup('Deletes one of the caller’s recorded or proposed worklogs under the time form’s rules. An entry with source keys is voided instead, so its source is not proposed again; either way it is no longer listed.'),
  operation: ToolOperation::Write,
  destructive: TRUE,
  input_definitions: [
    'worklog' => new InputDefinition('string', new TranslatableMarkup('Worklog'), new TranslatableMarkup('Worklog UUID.')),
    'version' => new InputDefinition('string', new TranslatableMarkup('Version'), new TranslatableMarkup('The version bakers_worklog_list returned; a changed entry is refused.')),
  ],
  output_definitions: [
    'id' => new OutputDefinition('string', new TranslatableMarkup('UUID'), new TranslatableMarkup('Worklog UUID.')),
    'voided' => new OutputDefinition('boolean', new TranslatableMarkup('Voided'), new TranslatableMarkup('TRUE when the entry was voided instead of removed.')),
  ],
)]
final class WorklogDelete extends ToolBase {

  use WorklogReferenceTrait;

  /**
   * Resolves UUIDs.
   */
  private EntityRepositoryInterface $repository;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    // ToolBase's constructor is final, so the service is set here.
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->repository = $container->get('entity.repository');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $entry = $this->editableWorklog($values['worklog'], 'delete');
    $voided = !$entry->get('source_keys')->isEmpty();
    // Always set: storage skips the lock without an expected version.
    $entry->expectedVersion = (string) $values['version'];
    $this->write(static fn() => $entry->delete());
    return ExecutableResult::success(
      $voided ? new TranslatableMarkup('Worklog voided.') : new TranslatableMarkup('Worklog deleted.'),
      ['id' => $entry->uuid(), 'voided' => $voided],
    );
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Delete access depends on the entry; doExecute() asks the entity.
    $access = AccessResult::allowedIf($account->isAuthenticated())->cachePerUser();
    return $return_as_object ? $access : $access->isAllowed();
  }

}
