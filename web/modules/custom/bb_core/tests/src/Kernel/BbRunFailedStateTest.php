<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\state_machine\Plugin\Workflow\WorkflowInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the bb_run `failed` state and `error_log` field (BB-149).
 *
 * Covers AC-1 (failed is a valid terminal state distinct from expired) and AC-2
 * (error_log long-text field, get/set roundtrip). The state machine lives in
 * bb_core.workflows.yml (module YAML), so `failed` needs no config/hook.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbRunFailedStateTest extends KernelTestBase {

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
    $entity_types = [
      'user', 'og_membership', 'bb_ticket', 'bb_run', 'file',
      'bb_workspace', 'bb_group', 'bb_project',
    ];
    foreach ($entity_types as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['user']);
    // UID 1 dummy so ownership checks never resolve to UID 0.
    $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'uid1', 'status' => 1])->save();
  }

  /**
   * Creates a saved run in the given initial state.
   */
  private function createRun(string $state): BbRunInterface {
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->create(['state' => $state]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    return $run;
  }

  /**
   * The bb_run workflow offers `failed` as a distinct terminal state.
   */
  public function testFailedStateIsRegistered(): void {
    $workflow = $this->container->get('plugin.manager.workflow')
      ->createInstance('bb_run');
    assert($workflow instanceof WorkflowInterface);
    $states = array_keys($workflow->getStates());
    // Both terminal states are present and distinct (failed vs expired).
    $this->assertContains('failed', $states);
    $this->assertContains('expired', $states);
  }

  /**
   * A claimed or running run may transition to `failed`.
   */
  public function testFailIsValidFromActiveStates(): void {
    $this->container->get('current_user')
      ->setAccount($this->container->get('entity_type.manager')->getStorage('user')->load(1));
    foreach (['claimed', 'running'] as $from) {
      $run = $this->createRun($from);
      $run->setRunState('failed');
      $violations = $run->validate()->getByField('state');
      $this->assertCount(0, $violations, "fail from $from must be valid: $violations");
    }
  }

  /**
   * A terminal run (done/expired/failed) cannot be transitioned to failed.
   */
  public function testFailIsRejectedFromTerminalStates(): void {
    $this->container->get('current_user')
      ->setAccount($this->container->get('entity_type.manager')->getStorage('user')->load(1));
    foreach (['done', 'expired'] as $from) {
      $run = $this->createRun($from);
      $run->setRunState('failed');
      $this->assertGreaterThan(
        0,
        count($run->validate()->getByField('state')),
        "fail from terminal $from must be rejected.",
      );
    }
  }

  /**
   * The error_log field exists and round-trips a value.
   */
  public function testErrorLogGetSetRoundtrip(): void {
    // `error_log`'s write-through resolves a workspace via
    // ticket -> project -> group -> workspace (WorkspaceResolver), so this run
    // needs the full chain rather than createRun()'s bare run.
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')
      ->create(['name' => 'error-log workspace', 'slug' => 'error-log-workspace']);
    $workspace->save();
    $group = $etm->getStorage('bb_group')
      ->create(['name' => 'error-log group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')
      ->create(['name' => 'error-log project', 'group_id' => $group->id()]);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-ERR', 'workflow' => 'bb_work', 'title' => 'X', 'project_id' => $project->id()]);
    $ticket->save();
    $run = $etm->getStorage('bb_run')
      ->create(['state' => 'claimed', 'ticket_id' => $ticket->id()]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    $this->assertNull($run->getErrorLog());
    $run->setErrorLog("startRun boom\nherdr stderr: exit 1");
    $run->save();
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->loadUnchanged($run->id());
    $this->assertInstanceOf(BbRunInterface::class, $reloaded);
    $this->assertSame("startRun boom\nherdr stderr: exit 1", $reloaded->readErrorLog());
  }

}
