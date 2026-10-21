<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\bb_core\Entity\BbRun;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies BbRun state_machine workflow transitions and default state.
 *
 * Checks that a freshly created run defaults to the expected initial state
 * and that state_machine transitions advance the run through the workflow.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbRunWorkflowTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'field', 'og', 'file', 'image',
    'bb_core', 'state_machine', 'entity', 'user', 'options', 'text', 'link',
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
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('user');
    $this->installEntitySchema('file');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_ticket');
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
  }

  /**
   * Verifies the default run state and a valid transition to running.
   *
   * A freshly saved run must default to 'claimed', and the 'start' transition
   * must advance it to 'running' without validation errors.
   */
  public function testRunDefaultsToClaimedAndTransitionsToRunning(): void {
    $run = BbRun::create([]);
    $run->save();
    $this->assertSame('claimed', $run->get('state')->value);

    $state_item = $run->get('state')->first();
    $this->assertInstanceOf(StateItemInterface::class, $state_item);
    $state_item->applyTransitionById('start');
    $run->save();
    $this->assertSame('running', $run->get('state')->value);
  }

  /**
   * A claimed run can be expired via the 'expire' transition.
   *
   * The lease-expiry reaper terminalises a claimed-but-never-started zombie to
   * the 'expired' state; the workflow must allow claimed -> expired.
   */
  public function testClaimedRunTransitionsToExpired(): void {
    $run = BbRun::create([]);
    $run->save();
    $this->assertSame('claimed', $run->get('state')->value);

    $state_item = $run->get('state')->first();
    $this->assertInstanceOf(StateItemInterface::class, $state_item);
    $state_item->applyTransitionById('expire');
    $run->save();
    $this->assertSame('expired', $run->get('state')->value);
  }

  /**
   * A running run cannot be expired (running is never auto-reaped).
   *
   * The `expire` transition is defined only from `claimed`; a running run is
   * genuinely live, so the workflow must not offer running -> expired.
   */
  public function testRunningRunCannotBeExpired(): void {
    $run = BbRun::create([]);
    $run->save();
    $start = $run->get('state')->first();
    $this->assertInstanceOf(StateItemInterface::class, $start);
    $start->applyTransitionById('start');
    $run->save();
    $this->assertSame('running', $run->get('state')->value);

    $item = $run->get('state')->first();
    $this->assertInstanceOf(StateItemInterface::class, $item);
    $transitions = array_keys($item->getTransitions());
    $this->assertNotContains('expire', $transitions);
  }

  /**
   * The 'expired' state is terminal: no transition leaves it.
   */
  public function testExpiredIsTerminal(): void {
    $this->assertTrue(TypeWorkflows::isTerminal('bb_run', 'expired'));
  }

  /**
   * Cancelled runs are terminal while claimed and running runs remain active.
   */
  public function testCancelLeavesClaimedAndRunningAndIsTerminal(): void {
    $this->assertFalse(TypeWorkflows::isTerminal('bb_run', 'claimed'));
    $this->assertFalse(TypeWorkflows::isTerminal('bb_run', 'running'));
    $this->assertTrue(TypeWorkflows::isTerminal('bb_run', 'cancelled'));
    $this->assertSame('cancelled', TypeWorkflows::phase('bb_run', 'cancelled'));
  }

  /**
   * Verifies that worktree_path and log fields are persisted and reloaded.
   *
   * Checks that execution-context fields introduced by Phase 8 round-trip
   * correctly through save/load without data loss.
   */
  public function testRunStoresWorktreeAndLog(): void {
    // `log`'s write-through resolves a workspace via
    // ticket -> project -> group -> workspace (WorkspaceResolver), so this run
    // needs the full chain.
    $etm = \Drupal::entityTypeManager();
    $workspace = $etm->getStorage('bb_workspace')
      ->create(['name' => 'PROJ-1 workspace', 'slug' => 'proj-1-workspace']);
    $workspace->save();
    $group = $etm->getStorage('bb_group')
      ->create(['name' => 'PROJ-1 group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')
      ->create(['name' => 'PROJ-1', 'group_id' => $group->id()]);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')
      ->create(['identifier' => 'PROJ-1', 'workflow' => 'bb_bug', 'title' => 'X', 'project_id' => $project->id()]);
    $ticket->save();
    $run = BbRun::create([
      'ticket_id' => $ticket->id(),
      'worktree_path' => '/srv/ws/PROJ-1',
      'log' => 'line one',
    ]);
    $run->save();
    $id = $run->id();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_run');
    $storage->resetCache([$id]);
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbRunInterface::class, $reloaded);
    $this->assertSame('/srv/ws/PROJ-1', $reloaded->get('worktree_path')->value);
    $this->assertSame('line one', $reloaded->readLog());
  }

}
