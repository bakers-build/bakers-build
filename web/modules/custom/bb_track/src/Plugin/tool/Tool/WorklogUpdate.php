<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityConstraintViolationListInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkAssignments;
use Drupal\bb_track\WorkTimeRules;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Corrects one of the caller's recorded or proposed worklogs.
 */
#[Tool(
  id: 'bakers_worklog_update',
  label: new TranslatableMarkup('Update own worklog'),
  description: new TranslatableMarkup('Changes one of the caller’s recorded or proposed worklogs under the time form’s rules; fields not given are kept. A new project clears the ticket, and a new project or ticket returns the billing account to its default, unless given. Returns the saved worklog with its new version.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  input_definitions: [
    'worklog' => new InputDefinition('string', new TranslatableMarkup('Worklog'), new TranslatableMarkup('Worklog UUID.')),
    'version' => new InputDefinition('string', new TranslatableMarkup('Version'), new TranslatableMarkup('The version bakers_worklog_list returned; a changed entry is refused.')),
    'work_date' => new InputDefinition('string', new TranslatableMarkup('Work date'), new TranslatableMarkup('Civil date, Y-m-d.'), required: FALSE),
    'duration_seconds' => new InputDefinition('integer', new TranslatableMarkup('Duration'), new TranslatableMarkup('Whole minutes in seconds, 60 to 86400.'), required: FALSE),
    'description' => new InputDefinition('string', new TranslatableMarkup('Description'), new TranslatableMarkup('What was done, 1 to 2000 characters.'), required: FALSE),
    'project' => new InputDefinition('string', new TranslatableMarkup('Project'), new TranslatableMarkup('Project UUID you may record on.'), required: FALSE),
    'ticket' => new InputDefinition('string', new TranslatableMarkup('Ticket'), new TranslatableMarkup('Ticket UUID of the project; empty clears it.'), required: FALSE),
    'account' => new InputDefinition('string', new TranslatableMarkup('Billing account'), new TranslatableMarkup('Billing account UUID of the project; empty returns to the default.'), required: FALSE),
  ],
  output_definitions: [
    'id' => new OutputDefinition('string', new TranslatableMarkup('UUID'), new TranslatableMarkup('Worklog UUID.')),
    'version' => new OutputDefinition('string', new TranslatableMarkup('Version'), new TranslatableMarkup('The new lock token.')),
    'work_date' => new OutputDefinition('string', new TranslatableMarkup('Work date'), new TranslatableMarkup('Civil date, Y-m-d.')),
    'state' => new OutputDefinition('string', new TranslatableMarkup('State'), new TranslatableMarkup('recorded or proposed.')),
    'duration_seconds' => new OutputDefinition('integer', new TranslatableMarkup('Duration'), new TranslatableMarkup('Seconds.')),
    'description' => new OutputDefinition('string', new TranslatableMarkup('Description'), new TranslatableMarkup('What was done.')),
    'source_keys' => new ListOutputDefinition(
      label: new TranslatableMarkup('Source keys'),
      description: new TranslatableMarkup('Hashed source identities.'),
      item_definition: new OutputDefinition('string', new TranslatableMarkup('Source key'), new TranslatableMarkup('A hashed source identity.')),
    ),
    'project_id' => new OutputDefinition('string', new TranslatableMarkup('Project'), new TranslatableMarkup('Project UUID, or null.'), nullable: TRUE),
    'ticket_id' => new OutputDefinition('string', new TranslatableMarkup('Ticket'), new TranslatableMarkup('Ticket UUID, or null.'), nullable: TRUE),
    'submission_id' => new OutputDefinition('string', new TranslatableMarkup('Submission'), new TranslatableMarkup('Submission UUID, or null.'), nullable: TRUE),
    'account' => new OutputDefinition('string', new TranslatableMarkup('Billing account'), new TranslatableMarkup('Billing account UUID, or null.'), nullable: TRUE),
    'omitted' => new OutputDefinition('boolean', new TranslatableMarkup('Omitted'), new TranslatableMarkup('TRUE when a reference is unreadable and therefore null.')),
  ],
)]
final class WorklogUpdate extends ToolBase {

  use WorklogReferenceTrait;
  use WorklogRowTrait;

  private const FIELDS = ['work_date', 'duration_seconds', 'description', 'project', 'ticket', 'account'];

  /**
   * Loads the saved worklog and its references.
   */
  private EntityTypeManagerInterface $entities;

  /**
   * Resolves UUIDs.
   */
  private EntityRepositoryInterface $repository;

  /**
   * Checks the recording target.
   */
  private WorkAssignments $assignments;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    // ToolBase's constructor is final, so the services are set here.
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entities = $container->get('entity_type.manager');
    $instance->repository = $container->get('entity.repository');
    $instance->assignments = $container->get('bb_track.assignments');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $entry = $this->editableWorklog($values['worklog'], 'update');
    $changes = array_filter(array_intersect_key($values, array_flip(self::FIELDS)), static fn($value) => $value !== NULL);
    if ($changes === []) {
      throw new \InvalidArgumentException('Nothing to update.');
    }
    try {
      $this->apply($entry, $changes);
      // Always set: storage skips the lock without an expected version.
      $entry->expectedVersion = (string) $values['version'];
      $violations = $entry->validate();
      if ($violations instanceof EntityConstraintViolationListInterface) {
        $violations->filterByFields(['owner_user_id', 'project_id', 'ticket_id']);
      }
      foreach ($violations as $violation) {
        throw new \InvalidArgumentException((string) $violation->getMessage());
      }
      $entry->save();
    }
    catch (\DomainException $error) {
      throw new \InvalidArgumentException($error->getMessage(), 0, $error);
    }
    catch (EntityStorageException $error) {
      // Only the storage's own refusals; wrapped database errors stay hidden.
      if ($error->getPrevious() !== NULL) {
        throw $error;
      }
      throw new \InvalidArgumentException($error->getMessage(), 0, $error);
    }
    $saved = $this->entities->getStorage('bb_track_worklog')->loadUnchanged($entry->id());
    assert($saved instanceof Worklog);
    $omitted = FALSE;
    $row = $this->worklogRow($saved, $this->references([$saved]), $omitted);
    return ExecutableResult::success(new TranslatableMarkup('Worklog updated.'), $row + ['omitted' => $omitted]);
  }

  /**
   * Sets the given fields, as the time form does.
   *
   * @param \Drupal\bb_track\Entity\Worklog $entry
   *   The worklog.
   * @param array<string, mixed> $changes
   *   The given fields.
   *
   * @throws \InvalidArgumentException
   * @throws \DomainException
   */
  private function apply(Worklog $entry, array $changes): void {
    if (isset($changes['work_date'])) {
      $entry->set('work_date', WorkTimeRules::date($changes['work_date']));
    }
    if (isset($changes['duration_seconds'])) {
      WorkTimeRules::seconds($changes['duration_seconds']);
      $entry->set('duration_seconds', $changes['duration_seconds']);
    }
    if (isset($changes['description'])) {
      $description = trim((string) $changes['description']);
      if ($description === '' || mb_strlen($description) > 2000) {
        throw new \InvalidArgumentException('Description must be 1 to 2000 characters.');
      }
      $entry->set('description', $description);
    }
    $project = (int) $entry->get('project_id')->target_id;
    $ticket = $entry->get('ticket_id')->target_id ? (int) $entry->get('ticket_id')->target_id : NULL;
    if (isset($changes['project'])) {
      $project = $this->reference('bb_project', $changes['project']);
      $ticket = NULL;
    }
    if (isset($changes['ticket'])) {
      $ticket = $changes['ticket'] === '' ? NULL : $this->reference('bb_ticket', $changes['ticket']);
    }
    $retargeted = $project !== (int) $entry->get('project_id')->target_id
      || $ticket !== ($entry->get('ticket_id')->target_id ? (int) $entry->get('ticket_id')->target_id : NULL);
    if ($retargeted) {
      $this->assignments->recordingTarget($project, $ticket);
    }
    if (($changes['account'] ?? '') !== '') {
      $entry->set('account_id', $this->reference('bb_track_account', $changes['account']));
    }
    elseif (isset($changes['account']) || $retargeted) {
      $entry->set('account_id', $this->assignments->resolveAccountId($project, $ticket));
    }
    $entry->set('project_id', $project)->set('ticket_id', $ticket);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Update access depends on the entry; doExecute() asks the entity.
    $access = AccessResult::allowedIf($account->isAuthenticated())->cachePerUser();
    return $return_as_object ? $access : $access->isAllowed();
  }

}
