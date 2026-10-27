<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Base class for claim kernel tests.
 *
 * Provides a seeded conductor and a set of helper methods for creating tickets
 * and runs so individual test classes can focus on their specific scenarios.
 */
#[RunTestsInSeparateProcesses]
abstract class ClaimKernelTestBase extends KernelTestBase {

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
   * The shared conductor used across test cases.
   */
  protected BbConductorInterface $conductor;

  /**
   * The claim service under test.
   */
  protected TicketClaimService $claimService;

  /**
   * The default project entity ID.
   */
  private int $projectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
      'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['user']);
    // UID 1 dummy so entity ownership checks don't hit UID 0.
    $this->createUser('uid1-dummy');
    $this->projectId = $this->createProject('default-project');

    $owner = $this->createConductorUser('claim-base-owner');
    $this->conductor = $this->createConductor(
      $owner,
      'node-base',
      ['plan', 'working', 'review'],
    );
    $this->claimService = $this->container->get('bb_core.ticket_claim');
  }

  /**
   * Creates and saves a BbProject under a fresh workspace/group chain.
   *
   * The chain is needed so RunLogStore's write-through in BbRun::preSave()
   * can resolve a run's workspace (WorkspaceResolver walks
   * ticket -> project -> group -> workspace).
   */
  private function createProject(string $name): int {
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')
      ->create(['name' => $name . ' workspace', 'slug' => 'ws-' . $name]);
    $workspace->save();
    $group = $etm->getStorage('bb_group')
      ->create(['name' => $name . ' group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')
      ->create(['name' => $name, 'group_id' => $group->id()]);
    $project->save();
    return (int) $project->id();
  }

  /**
   * Creates a plain Drupal user without special permissions.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')
      ->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a Drupal user with conductor registration and claim permissions.
   */
  private function createConductorUser(string $name): UserInterface {
    $role_id = 'conductor_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')
      ->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])
      ->save();
    user_role_grant_permissions($role_id, ['register bakers conductor', 'claim bakers tickets']);
    $user = $this->container->get('entity_type.manager')
      ->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a BbConductor registered for a project and states.
   */
  private function createConductor(
    UserInterface $owner,
    string $machine_id,
    array $states = ['plan', 'working'],
  ): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => $machine_id,
        'label' => $machine_id,
        'owner_user_id' => $owner->id(),
        'status' => 'online',
        'project_id' => $this->projectId,
        'states' => $states,
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates an assigned ticket in the given workflow state.
   *
   * The ticket is assigned to the shared conductor so it passes the
   * conductor-assignment gate in TicketClaimService.
   *
   * @param string $state
   *   The workflow state to put the ticket in (e.g. 'working', 'plan').
   * @param string $identifier
   *   Optional human-readable identifier; defaults to a unique value.
   * @param string $workflow
   *   Workflow plugin id (default bb_work).
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket entity.
   */
  protected function seedAssignedTicket(string $state = 'plan', string $identifier = '', string $workflow = 'bb_work'): BbTicketInterface {
    if ($identifier === '') {
      $identifier = 'GL-SEED-' . mt_rand();
    }

    // Create the ticket; it enters the 'qualification' state (the workflow's
    // first state, BB-196).
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'workflow' => $workflow,
        'title' => $identifier,
        'project_id' => $this->projectId,
        'conductor_id' => $this->conductor->id(),
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();

    // Advance to the requested state via workflow transitions if needed.
    // bb_work: qualification → plan (qualify) → working → review.
    $transitions = [
      'qualification' => [],
      'plan' => ['qualify'],
      'working' => ['qualify', 'to_working'],
      'review' => ['qualify', 'to_working', 'to_review'],
    ];
    foreach ($transitions[$state] ?? [] as $transition) {
      $ticket->getState()->applyTransitionById($transition);
    }
    $ticket->save();

    return $ticket;
  }

  /**
   * Creates and saves a BbRun with explicit state values for the ticket.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to attach the run to.
   * @param string $stateAtStart
   *   The ticket state that was current when this run started.
   * @param string $state
   *   The current run state (e.g. 'claimed', 'running', 'done').
   * @param int|null $claimExpiresAt
   *   Absolute lease-expiry timestamp; defaults to now + 600 (a live lease).
   *   Pass a past timestamp to seed an expired-lease zombie.
   *
   * @return \Drupal\bb_core\Entity\BbRunInterface
   *   The saved run entity.
   */
  protected function seedRun(
    BbTicketInterface $ticket,
    string $stateAtStart,
    string $state,
    ?int $claimExpiresAt = NULL,
  ): BbRunInterface {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $run = $this->container->get('entity_type.manager')
      ->getStorage('bb_run')
      ->create([
        'ticket_id' => $ticket->id(),
        'conductor_id' => $this->conductor->id(),
        'state' => $state,
        'claim_expires_at' => $claimExpiresAt ?? $now + 600,
        'state_at_start' => $stateAtStart,
        'started_at' => $now,
      ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    return $run;
  }

  /**
   * Reloads a run entity from the database, bypassing the entity cache.
   *
   * @param \Drupal\bb_core\Entity\BbRunInterface $run
   *   The run entity to reload.
   *
   * @return \Drupal\bb_core\Entity\BbRunInterface
   *   A freshly loaded run entity.
   */
  protected function reloadRun(BbRunInterface $run): BbRunInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    $this->assertInstanceOf(BbRunInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Reloads a ticket entity from the database, bypassing the entity cache.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket entity to reload.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   A freshly loaded ticket entity.
   */
  protected function reloadTicket(BbTicketInterface $ticket): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

}
