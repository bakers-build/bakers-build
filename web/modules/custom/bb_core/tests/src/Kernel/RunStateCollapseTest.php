<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\state_machine\Plugin\Workflow\WorkflowInterface;

/**
 * Verifies the full bb_run state set.
 *
 * @group bb_core
 */
final class RunStateCollapseTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'text', 'link', 'field', 'og',
    'state_machine', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('og_membership');
  }

  /**
   * Tests the full bb_run state set.
   *
   * `expired` is the lease-expiry reaper's terminal target (BB-63): distinct
   * from `done` so reaped zombies stay separable in metrics/history. `failed`
   * (BB-149) is the second terminal outcome — a dispatch/setup error — kept
   * distinct from `expired` (lease lapse) so failures are separable too.
   * `cancelled` (BB-536) is the third: an operator ends a live run so the
   * ticket can be claimed again.
   *
   * This is a hand-mirrored run-state list, a sibling of `STATE_MARKS`,
   * `CANCELLABLE_RUN_STATES`, `bb_run.transitions.cancel.from` and
   * `RunLeaseGuardConstraintValidator::TERMINAL_STATES` — widen all of them
   * together when a state is added.
   */
  public function testRunStatesAreClaimedRunningDoneExpiredFailedCancelled(): void {
    $workflow = \Drupal::service('plugin.manager.workflow')->createInstance('bb_run');
    assert($workflow instanceof WorkflowInterface);
    $states = array_keys($workflow->getStates());
    sort($states);
    self::assertSame(['cancelled', 'claimed', 'done', 'expired', 'failed', 'running'], $states);
  }

  /**
   * Tests that the finish transition is reachable from the running state.
   */
  public function testFinishTransitionFromRunning(): void {
    $workflow = \Drupal::service('plugin.manager.workflow')->createInstance('bb_run');
    assert($workflow instanceof WorkflowInterface);
    // Verify the 'finish' transition is available from the 'running' state.
    $transitions = $workflow->getPossibleTransitions('running');
    $to_states = array_map(fn($t) => $t->getToState()->getId(), $transitions);
    self::assertContains('done', $to_states, 'The finish transition must be reachable from running.');
  }

}
