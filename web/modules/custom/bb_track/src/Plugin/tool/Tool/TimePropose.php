<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\tool\Tool;

use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkActivityInput;
use Drupal\bb_track\WorkTimeMutation;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListInputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapInputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Stores the caller's activities as one unbooked proposal, all or nothing.
 */
#[Tool(
  id: 'bakers_time_propose',
  label: new TranslatableMarkup('Propose time'),
  description: new TranslatableMarkup('Stores activities as proposed worklogs of one new proposed submission owned by the caller, for review in the week sheet. Any failing entry stores nothing; the message names it by 1-based position and source_key.'),
  operation: ToolOperation::Write,
  destructive: FALSE,
  input_definitions: [
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project UUID used by entries that name none.'),
      required: FALSE,
    ),
    'account' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Billing account'),
      description: new TranslatableMarkup('Billing account UUID used by entries that name none; otherwise the project or ticket default applies.'),
      required: FALSE,
    ),
    'entries' => new ListInputDefinition(
      label: new TranslatableMarkup('Entries'),
      description: new TranslatableMarkup('The activities, one worklog each.'),
      constraints: ['NotBlank' => []],
      item_definition: new MapInputDefinition(
        label: new TranslatableMarkup('Entry'),
        description: new TranslatableMarkup('One activity with stable source identity.'),
        property_definitions: [
          'source_system' => new InputDefinition('string', new TranslatableMarkup('Source system'), new TranslatableMarkup('Where the activity comes from, e.g. git.')),
          'source_key' => new InputDefinition('string', new TranslatableMarkup('Source key'), new TranslatableMarkup('Stable key of the activity within its source system.')),
          'source_version' => new InputDefinition('string', new TranslatableMarkup('Source version'), new TranslatableMarkup('Version of the activity; a recorded key with other content is refused.')),
          'work_date' => new InputDefinition('string', new TranslatableMarkup('Work date'), new TranslatableMarkup('Civil date, Y-m-d.')),
          'description' => new InputDefinition('string', new TranslatableMarkup('Description'), new TranslatableMarkup('What was done, at most 2000 characters.')),
          'duration_seconds' => new InputDefinition('integer', new TranslatableMarkup('Duration'), new TranslatableMarkup('Whole minutes in seconds, 60 to 86400.')),
          'project' => new InputDefinition('string', new TranslatableMarkup('Project'), new TranslatableMarkup('Project UUID; defaults to the top-level project.'), required: FALSE),
          'ticket' => new InputDefinition('string', new TranslatableMarkup('Ticket'), new TranslatableMarkup('Ticket UUID of the project.'), required: FALSE),
          'account' => new InputDefinition('string', new TranslatableMarkup('Billing account'), new TranslatableMarkup('Billing account UUID; defaults to the top-level account.'), required: FALSE),
        ],
      ),
    ),
  ],
  output_definitions: [
    'submission' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Submission UUID'),
      description: new TranslatableMarkup('The new proposed submission.'),
    ),
    'worklogs' => new ListOutputDefinition(
      label: new TranslatableMarkup('Worklog UUIDs'),
      description: new TranslatableMarkup('One worklog per entry, in entry order.'),
      item_definition: new OutputDefinition('string', new TranslatableMarkup('Worklog UUID'), new TranslatableMarkup('A proposed worklog.')),
    ),
  ],
)]
final class TimePropose extends ToolBase {

  private const FIELDS = [
    'source_system', 'source_key', 'source_version', 'work_date', 'description',
    'duration_seconds', 'project', 'ticket', 'account',
  ];

  /**
   * The owner lock and transaction boundary.
   */
  private WorkTimeMutation $mutation;

  /**
   * The shared activity rules.
   */
  private WorkActivityInput $activities;

  /**
   * Resolves reference UUIDs.
   */
  private EntityRepositoryInterface $repository;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    // ToolBase's constructor is final, so the services are set here.
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->mutation = $container->get('bb_track.mutation');
    $instance->activities = $container->get('bb_track.activity_input');
    $instance->repository = $container->get('entity.repository');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $owner = (int) $this->currentUser->id();
    [$submission, $worklogs] = $this->mutation->run('owner:' . $owner, function () use ($values): array {
      $submission = Submission::create(['state' => 'proposed']);
      if (!$submission->access('create', $this->currentUser)) {
        throw new \InvalidArgumentException('You may not record time.');
      }
      $submission->save();
      $defaults = ['project' => $values['project'] ?? NULL, 'account' => $values['account'] ?? NULL];
      $worklogs = [];
      foreach (array_values($values['entries']) as $index => $entry) {
        try {
          $worklogs[] = $this->entry($entry + $defaults, (int) $submission->id())->uuid();
        }
        catch (\InvalidArgumentException | \DomainException $error) {
          throw new \InvalidArgumentException(sprintf('Entry %d (%s): %s', $index + 1, $entry['source_key'] ?? '', $error->getMessage()), 0, $error);
        }
      }
      return [$submission, $worklogs];
    });
    return ExecutableResult::success(new TranslatableMarkup('Proposal stored.'), [
      'submission' => $submission->uuid(),
      'worklogs' => $worklogs,
    ]);
  }

  /**
   * Records one entry into the proposal through the shared activity rules.
   *
   * @param array<string, mixed> $entry
   *   The entry with its defaults applied.
   * @param int $submission
   *   The proposal's id.
   */
  private function entry(array $entry, int $submission): Worklog {
    if (array_diff(array_keys($entry), self::FIELDS)) {
      throw new \InvalidArgumentException('Unknown activity field; owner and approval fields are not accepted.');
    }
    $input = array_diff_key($entry, array_flip(['project', 'ticket', 'account'])) + ['submission_id' => $submission];
    foreach (['project' => 'bb_project', 'ticket' => 'bb_ticket', 'account' => 'bb_track_account'] as $field => $type) {
      if (isset($entry[$field])) {
        $input[$field . '_id'] = $this->reference($type, $entry[$field]);
      }
    }
    return $this->activities->input($input);
  }

  /**
   * Resolves a viewable reference UUID to its id.
   *
   * @throws \InvalidArgumentException
   * @throws \DomainException
   */
  private function reference(string $type, mixed $uuid): int {
    if (!is_string($uuid) || !Uuid::isValid($uuid)) {
      throw new \InvalidArgumentException('Project, ticket and billing account references must be UUIDs.');
    }
    $entity = $this->repository->loadEntityByUuid($type, $uuid);
    if (!$entity || !$entity->access('view', $this->currentUser)) {
      throw new \DomainException('Assignment unavailable.');
    }
    return (int) $entity->id();
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Recording rights are per workspace; the activity rules check them.
    $access = AccessResult::allowedIf($account->isAuthenticated())->cachePerUser();
    return $return_as_object ? $access : $access->isAllowed();
  }

}
