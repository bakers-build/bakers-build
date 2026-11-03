<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\Core\Entity\Sql\SqlEntityStorageInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\bb_core\ListBuilder\BbLabelListBuilder;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Validates persistence and constraints for all bakers.build entity types.
 *
 * Checks that each entity (group, project, conductor, ticket, comment,
 * run) can be saved/reloaded with all required schema fields, and that
 * validation constraints reject invalid data (negative values, unknown list
 * keys, duplicate identifiers).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntitySchemaTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   *
   * Core's own service provider only registers the `private` stream wrapper
   * when `file_private_path` is already set at container-build time, which is
   * before this test's setUp() gets a chance to call setSetting().
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership',
      'bb_group',
      'bb_project',
      'bb_conductor',
      'bb_ticket',
      'bb_comment',
      'bb_run',
      'bb_term',
      'file',
      'bb_workspace',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->ensureVocabulary('label', 'bakers.build labels');
  }

  /**
   * Verifies that a BbGroup entity round-trips with all fields intact.
   *
   * Checks name and billing-profile composite field values.
   */
  public function testGroupPersists(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_group');
    $group = $storage->create([
      'name' => 'ACME',
      'billing_profile' => ['currency' => 'EUR', 'hourly_rate' => 120],
    ]);
    $group->save();

    $loaded = $storage->load($group->id());
    $this->assertInstanceOf(BbGroupInterface::class, $loaded);
    $this->assertSame('ACME', $loaded->label());
    $this->assertSame('ACME', $loaded->getName());
    $this->assertSame('EUR', $loaded->get('billing_profile')->first()->getValue()['currency']);
  }

  /**
   * Verifies that groups and teams share one label-column list builder.
   */
  public function testGroupAndTeamShareTheLabelListBuilder(): void {
    $this->installEntitySchema('bb_team');
    $entity_type_manager = $this->container->get('entity_type.manager');
    foreach (['bb_group', 'bb_team'] as $type) {
      $list_builder = $entity_type_manager->getListBuilder($type);
      $this->assertInstanceOf(BbLabelListBuilder::class, $list_builder);
      $this->assertSame('name', array_key_first($list_builder->buildHeader()));
      $entity = $entity_type_manager->getStorage($type)->create(['name' => "ACME $type"]);
      $this->assertSame("ACME $type", $list_builder->buildRow($entity)['name']);
    }
  }

  /**
   * Verifies that a BbProject entity round-trips with core fields intact.
   *
   * Checks the repository field is persisted, and confirms removed fields
   * (workflow-cache, default_agent_profile, active_workflow_policy,
   * active_workflow_skills) are absent from the schema. `members` joins that
   * list in BB-317: the project is an OG group now, so membership is an
   * og_membership entity rather than a bare user reference list.
   */
  public function testProjectPersistsCoreFields(): void {
    $group = $this->container->get('entity_type.manager')->getStorage('bb_group')->create(['name' => 'ACME']);
    $group->save();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_project');
    $project = $storage->create([
      'group_id' => $group->id(),
      'name' => 'Demo',
      'repository' => [
        [
          'url' => 'https://example.com/demo.git',
          'default_branch' => 'main',
        ],
      ],
      'env_vars' => "A=1\nB=2",
    ]);
    $project->save();

    $loaded = $storage->load($project->id());
    $this->assertInstanceOf(BbProjectInterface::class, $loaded);
    $this->assertSame('Demo', $loaded->getName());
    $this->assertSame((int) $group->id(), (int) $loaded->getGroupId());
    $this->assertSame('ACME', $loaded->getGroup()->getName());
    $this->assertSame('https://example.com/demo.git', $loaded->get('repository')->first()->get('url')->getValue());
    $this->assertSame('main', $loaded->get('repository')->first()->get('default_branch')->getValue());
    $this->assertSame(1, $loaded->getFieldDefinition('repository')->getFieldStorageDefinition()->getCardinality());
    $this->assertSame("A=1\nB=2", $loaded->get('env_vars')->value);
    $this->assertFalse($loaded->hasField('members'));
    $this->assertFalse($loaded->hasField('workflow_file_path'));
    $this->assertFalse($loaded->hasField('workflow_ref'));
    $this->assertFalse($loaded->hasField('workflow_instructions_hash'));
    $this->assertFalse($loaded->hasField('workflow_instructions_loaded_at'));
    $this->assertFalse($loaded->hasField('default_agent_profile'));
    $this->assertFalse($loaded->hasField('active_workflow_policy'));
    $this->assertFalse($loaded->hasField('active_workflow_skills'));
  }

  /**
   * Verifies that a BbConductor entity round-trips with registration fields.
   *
   * Checks conductor_id, status, project, reported_load, and registered states
   * are persisted; capacity fields are absent (BB-353).
   */
  public function testConductorPersistsCanonicalRegistrationFields(): void {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'conductor-project']);
    $project->save();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $node = $storage->create([
      'label' => 'CW Laptop',
      'owner_user_id' => 1,
      'status' => 'online',
      'project_id' => $project->id(),
      'workspace_root' => '/home/cw/bakers-workspaces',
      'reported_load' => 1,
      'last_seen' => 1767225600,
      'lease_expires_at' => 1767225900,
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $node);
    $node->set('states', ['review', 'human_input']);
    $node->save();

    $loaded = $storage->load($node->id());
    $this->assertInstanceOf(BbConductorInterface::class, $loaded);
    $this->assertSame('conductor', $loaded->getVariant());
    $this->assertFalse($loaded->hasField('conductor_id'));
    $this->assertSame('online', $loaded->getStatus());
    $this->assertContains('human_input', $loaded->getStates());
    $this->assertSame('list_string', $loaded->get('states')->getFieldDefinition()->getType());
    $this->assertSame((int) $project->id(), (int) $loaded->get('project_id')->target_id);
    $this->assertSame(1, (int) $loaded->get('reported_load')->value);
    $this->assertTrue($loaded->hasField('machine'));
    $this->assertFalse($loaded->hasField('machine_id'));
    $this->assertFalse($loaded->hasField('max_parallel'));
    $this->assertFalse($loaded->hasField('current_load'));
    $this->assertFalse($loaded->hasField('roles'));
    $this->assertFalse($loaded->hasField('modes'));
    $this->assertFalse($loaded->hasField('capability_tags'));
    $this->assertFalse($loaded->hasField('pool'));
  }

  /**
   * Verifies that a BbTicket entity round-trips with all spec fields.
   *
   * Checks parent, blockers, origin, and links are persisted, and confirms
   * removed fields are absent from the schema.
   */
  public function testTicketPersistsSpecFields(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $parent = $storage->create(['identifier' => 'GL-100', 'workflow' => 'bb_work', 'title' => 'Parent']);
    $parent->save();
    $blocker = $storage->create(['identifier' => 'GL-101', 'workflow' => 'bb_work', 'title' => 'Blocker']);
    $blocker->save();

    $ticket = $storage->create([
      'identifier' => 'GL-102',
      'workflow' => 'bb_work',
      'title' => 'Child',
      'assignee_user_id' => 1,
      'priority' => 2,
      'parent_id' => $parent->id(),
      'blocked_by' => [$blocker->id()],
      'origin' => 'https://example.com/issues/42',
      'links' => [['uri' => 'https://example.com/mr/1', 'title' => 'MR !1']],
    ]);
    $ticket->save();

    $loaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $loaded);
    $this->assertSame(2, $loaded->getPriority());
    $this->assertSame((int) $parent->id(), $loaded->getParentId());
    $this->assertSame([(int) $blocker->id()], $loaded->getBlockedByIds());
    $this->assertSame('https://example.com/issues/42', $loaded->get('origin')->value);
    $this->assertSame('link', $loaded->get('links')->getFieldDefinition()->getType());
    $this->assertTrue($loaded->hasField('comments'));
    $this->assertFalse($loaded->hasField('conductor_pool'));
    $this->assertFalse($loaded->hasField('conductor_tags'));
    $this->assertFalse($loaded->hasField('selected_conductor_id'));
    $this->assertFalse($loaded->hasField('current_handler'));
    $this->assertFalse($loaded->hasField('agent_profile'));
    $this->assertFalse($loaded->hasField('estimate'));
    $this->assertFalse($loaded->hasField('has_open_blockers'));
    $this->assertFalse($loaded->hasField('claim_lease_expires_at'));
  }

  /**
   * Verifies that a BbComment entity persists as an independent entity.
   *
   * Checks that the ticket reference and body field are reloaded correctly.
   */
  public function testCommentPersistsAsEntity(): void {
    $ticket_storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ticket = $ticket_storage->create(['identifier' => 'GL-COM', 'workflow' => 'bb_work', 'title' => 'With comment']);
    $ticket->save();

    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
      'ticket_id' => $ticket->id(),
      'author' => 1,
      'body' => 'first',
      'created' => 1767225600,
    ]);
    $this->assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();

    $loaded = $this->container->get('entity_type.manager')->getStorage('bb_comment')->load($comment->id());
    $this->assertInstanceOf(BbCommentInterface::class, $loaded);
    $this->assertSame((int) $ticket->id(), $loaded->getTicketId());
    $this->assertSame('first', $loaded->get('body')->value);
  }

  /**
   * Verifies that a BbConductor with an unrecognised state fails validation.
   *
   * Expects a violation on the states field; backlog/terminal states are not
   * dispatchable and therefore not allowed either.
   */
  public function testConductorStateValuesAreValidated(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $node = $storage->create([
      'label' => 'invalid-state',
      'owner_user_id' => 1,
      'states' => ['does_not_exist'],
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $node);
    $violations = $node->validate();
    $this->assertGreaterThan(0, count($violations->getByField('states')));

    $terminal = $storage->create([
      'label' => 'terminal-state',
      'owner_user_id' => 1,
      'states' => ['done'],
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $terminal);
    $this->assertGreaterThan(0, count($terminal->validate()->getByField('states')));
  }

  /**
   * Verifies the removed assignee_type field is absent from bb_ticket.
   *
   * Also confirms assignee_user_id is still defined.
   */
  public function testTicketDoesNotDefineAssigneeType(): void {
    $fields = $this->container->get('entity_field.manager')->getBaseFieldDefinitions('bb_ticket');
    $this->assertArrayNotHasKey('assignee_type', $fields);
    $this->assertArrayHasKey('assignee_user_id', $fields);
    // The conductor assignment field drives run start (decoupled from user).
    $this->assertArrayHasKey('conductor_id', $fields);
    $this->assertSame('bb_conductor', $fields['conductor_id']->getSetting('target_type'));
  }

  /**
   * Verifies that the ticket identifier uniqueness constraint is enforced.
   *
   * A second ticket with an already-used identifier must produce a violation.
   */
  public function testTicketIdentifierUnique(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->create(['identifier' => 'GL-DUP', 'workflow' => 'bb_work', 'title' => 'A'])->save();
    $second = $storage->create(['identifier' => 'GL-DUP', 'workflow' => 'bb_work', 'title' => 'B']);
    $this->assertInstanceOf(BbTicketInterface::class, $second);
    $violations = $second->validate();
    $this->assertGreaterThan(0, count($violations->getByField('identifier')));
  }

  /**
   * Verifies that a BbRun entity round-trips with claim-lease fields.
   *
   * Checks state, ticket reference, claim expiry, and new execution-context
   * fields (worktree_path, log).  Also confirms previously-dropped fields are
   * absent from the schema.
   */
  public function testRunPersistsClaimLeaseFields(): void {
    $etm = $this->container->get('entity_type.manager');
    // A run's `log` write-through resolves a workspace via
    // ticket -> project -> group -> workspace (WorkspaceResolver), so this
    // ticket needs the full chain rather than the bare ticket other cases use.
    $workspace = $etm->getStorage('bb_workspace')
      ->create(['name' => 'GL-200 workspace', 'slug' => 'gl-200-workspace']);
    $workspace->save();
    $group = $etm->getStorage('bb_group')
      ->create(['name' => 'GL-200 group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')
      ->create(['name' => 'GL-200 project', 'group_id' => $group->id()]);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-200', 'workflow' => 'bb_work', 'title' => 'X', 'project_id' => $project->id()]);
    $ticket->save();

    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'claimed',
      'claim_expires_at' => 1767225900,
      'state_at_start' => 'coding',
      'worktree_path' => '/srv/ws/GL-200',
      'log' => 'initial log',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();

    $loaded = $etm->getStorage('bb_run')->load($run->id());
    $this->assertInstanceOf(BbRunInterface::class, $loaded);
    $this->assertSame('claimed', $loaded->getRunState());
    $this->assertSame((int) $ticket->id(), $loaded->getTicketId());
    $this->assertSame(1767225900, $loaded->getClaimExpiresAt());
    $this->assertSame('/srv/ws/GL-200', $loaded->get('worktree_path')->value);
    $this->assertSame('initial log', $loaded->readLog());
    $this->assertFalse($loaded->hasField('session_id'));
    $this->assertFalse($loaded->hasField('session_user_id'));
    $this->assertFalse($loaded->hasField('handler_id'));
    $this->assertFalse($loaded->hasField('claim_owner'));
    $this->assertFalse($loaded->hasField('agent_profile_snapshot'));
    $this->assertFalse($loaded->hasField('workflow_path'));
    $this->assertFalse($loaded->hasField('workflow_ref'));
    $this->assertFalse($loaded->hasField('workflow_hash'));
    $this->assertFalse($loaded->hasField('outcome'));
    $this->assertFalse($loaded->hasField('finished_at'));
  }

  /**
   * Verifies the per-run footprint metric fields (BB-132).
   *
   * The six effort metrics are plain integer base fields on bb_run — each its
   * own DB column, so each stays a sortable/filterable Views field and is
   * auto-exposed over JSON:API. Asserts the field defs, schema columns, and a
   * round-trip set/get.
   */
  public function testRunPersistsFootprintFields(): void {
    $metric_fields = [
      'tokens',
      'duration_s',
      'agent_turns',
      'tool_calls',
      'user_prompts',
      'user_prompt_words',
      'active_s',
    ];
    $fields = $this->container->get('entity_field.manager')->getBaseFieldDefinitions('bb_run');
    foreach ($metric_fields as $name) {
      $this->assertArrayHasKey($name, $fields, "bb_run defines the {$name} field.");
      $this->assertSame('integer', $fields[$name]->getType(), "{$name} is an integer field.");
    }
    // No cost metric — explicitly out of scope for now (spec UPDATE 3).
    $this->assertArrayNotHasKey('cost', $fields);

    // Each metric has its own storage column on the base table.
    $run_storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $this->assertInstanceOf(SqlEntityStorageInterface::class, $run_storage);
    $table_mapping = $run_storage->getTableMapping();
    foreach ($metric_fields as $name) {
      $this->assertNotEmpty(
        $table_mapping->getColumnNames($name),
        "{$name} maps to a storage column.",
      );
    }

    $etm = $this->container->get('entity_type.manager');
    $ticket = $etm->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-FP', 'workflow' => 'bb_work', 'title' => 'Footprint']);
    $ticket->save();
    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'done',
      'tokens' => 185000,
      'duration_s' => 1240,
      'agent_turns' => 12,
      'tool_calls' => 40,
      'user_prompts' => 3,
      'user_prompt_words' => 57,
      'active_s' => 300,
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();

    $loaded = $etm->getStorage('bb_run')->load($run->id());
    $this->assertInstanceOf(BbRunInterface::class, $loaded);
    $this->assertSame(185000, (int) $loaded->get('tokens')->value);
    $this->assertSame(1240, (int) $loaded->get('duration_s')->value);
    $this->assertSame(12, (int) $loaded->get('agent_turns')->value);
    $this->assertSame(40, (int) $loaded->get('tool_calls')->value);
    $this->assertSame(3, (int) $loaded->get('user_prompts')->value);
    $this->assertSame(57, (int) $loaded->get('user_prompt_words')->value);
    $this->assertSame(300, (int) $loaded->get('active_s')->value);
  }

  /**
   * The run records the runtime that produced its footprint.
   */
  public function testRunPersistsRuntimeFields(): void {
    $runtime_fields = ['harness', 'model', 'model_version'];
    $fields = $this->container->get('entity_field.manager')->getBaseFieldDefinitions('bb_run');
    foreach ($runtime_fields as $name) {
      $this->assertArrayHasKey($name, $fields, "bb_run defines the {$name} field.");
      $this->assertSame('string', $fields[$name]->getType(), "{$name} is a string field.");
    }

    // Each runtime field has its own storage column on the base table.
    $run_storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $this->assertInstanceOf(SqlEntityStorageInterface::class, $run_storage);
    $table_mapping = $run_storage->getTableMapping();
    foreach ($runtime_fields as $name) {
      $this->assertNotEmpty(
        $table_mapping->getColumnNames($name),
        "{$name} maps to a storage column.",
      );
    }

    $etm = $this->container->get('entity_type.manager');
    $ticket = $etm->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-RT', 'workflow' => 'bb_work', 'title' => 'Runtime']);
    $ticket->save();
    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'done',
      'agent' => 'claude',
      'harness' => 'claude',
      'model' => 'claude-opus-5',
      'model_version' => 'claude-opus-4-5-20251101',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();

    $loaded = $etm->getStorage('bb_run')->load($run->id());
    $this->assertInstanceOf(BbRunInterface::class, $loaded);
    $this->assertSame('claude', $loaded->get('harness')->value);
    $this->assertSame('claude-opus-5', $loaded->get('model')->value);
    $this->assertSame('claude-opus-4-5-20251101', $loaded->get('model_version')->value);

    // The pre-existing agent field keeps its own value and meaning; harness
    // duplicating it here is deliberate, not a rename.
    $this->assertSame('claude', $loaded->get('agent')->value);
  }

  /**
   * An unwritten runtime field is NULL, so absence stays distinguishable.
   */
  public function testUnwrittenRuntimeFieldsAreNull(): void {
    $etm = $this->container->get('entity_type.manager');
    $ticket = $etm->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-RT2', 'workflow' => 'bb_work', 'title' => 'No runtime']);
    $ticket->save();
    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'done',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();

    $loaded = $etm->getStorage('bb_run')->load($run->id());
    $this->assertInstanceOf(BbRunInterface::class, $loaded);
    foreach (['harness', 'model', 'model_version'] as $name) {
      $this->assertNull($loaded->get($name)->value, "{$name} is NULL when never written.");
    }
  }

  /**
   * Verifies that the bb_run entity exposes a heartbeat timestamp field.
   *
   * Checks the field exists and accepts a Unix timestamp value that round-trips
   * correctly through the accessor.
   */
  public function testBbRunHasHeartbeatField(): void {
    $fields = $this->container->get('entity_field.manager')->getBaseFieldDefinitions('bb_run');
    $this->assertArrayHasKey('heartbeat', $fields);
    $this->assertSame('timestamp', $fields['heartbeat']->getType());

    $etm = $this->container->get('entity_type.manager');
    $ticket = $etm->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-HB', 'workflow' => 'bb_work', 'title' => 'Heartbeat']);
    $ticket->save();

    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'claimed',
      'claim_expires_at' => 1767225900,
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $this->assertNull($run->getHeartbeat());

    $run->setHeartbeat(1767225600);
    $run->save();

    $loaded = $etm->getStorage('bb_run')->load($run->id());
    $this->assertInstanceOf(BbRunInterface::class, $loaded);
    $this->assertSame(1767225600, $loaded->getHeartbeat());
  }

  /**
   * Verifies the `cleaned_up_date` base field exists and round-trips.
   *
   * An install gets the column from baseFieldDefinitions() directly
   * (BB-451).
   */
  public function testTicketPersistsCleanedUpDateField(): void {
    $fields = $this->container->get('entity_field.manager')->getBaseFieldDefinitions('bb_ticket');
    $this->assertArrayHasKey('cleaned_up_date', $fields);
    $this->assertSame('timestamp', $fields['cleaned_up_date']->getType());

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ticket = $storage->create(['workflow' => 'bb_work', 'title' => 'cleaned-up-date-field']);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $this->assertNull($ticket->getCleanedUpDate());

    $ticket->markCleanedUp()->save();
    $loaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $loaded);
    $this->assertNotNull($loaded->getCleanedUpDate());
  }

  /**
   * Creates the given taxonomy vocabulary if it does not already exist.
   *
   * @param string $vid
   *   Machine name of the vocabulary.
   * @param string $name
   *   Human-readable label.
   */
  private function ensureVocabulary(string $vid, string $name): void {
    if (BbVocabulary::load($vid) === NULL) {
      BbVocabulary::create(['id' => $vid, 'label' => $name])->save();
    }
  }

}
