<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the TypeWorkflows claimable-flag reader against the real workflows.
 *
 * Covers the claimable per-state flag and the claimable state option union
 * read from the installed bb_ticket workflow plugin definitions.
 */
#[Group('bb_core')]
final class TypeWorkflowsTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'field', 'og',
    'bb_core', 'state_machine', 'entity', 'user', 'options', 'text', 'link',
    'facets',
  ];

  /**
   * Verifies isClaimable() reflects the workflow `claimable` flag.
   */
  public function testIsClaimableReadsFlag(): void {
    foreach (['qualification', 'plan', 'working', 'review'] as $state) {
      $this->assertTrue(TypeWorkflows::isClaimable('bb_work', $state), $state);
    }
    // A state that is not flagged claimable (terminal) reports false.
    $this->assertFalse(TypeWorkflows::isClaimable('bb_work', 'done'));
    $this->assertFalse(TypeWorkflows::isClaimable('bb_work', 'cancelled'));
    // An unknown state reports false.
    $this->assertFalse(TypeWorkflows::isClaimable('bb_work', 'nonexistent'));
  }

  /**
   * Verifies stateOptions() unions only claimable states across workflows.
   */
  public function testStateOptionsListsOnlyClaimableStates(): void {
    $options = TypeWorkflows::stateOptions();
    $this->assertArrayHasKey('qualification', $options);
    $this->assertArrayHasKey('plan', $options);
    $this->assertArrayHasKey('working', $options);
    $this->assertArrayNotHasKey('coding', $options);
    $this->assertArrayHasKey('review', $options);
    $this->assertArrayNotHasKey('done', $options);
    $this->assertArrayNotHasKey('cancelled', $options);
  }

  /**
   * The run workflow's own states, named as the workflow declares them.
   */
  public function testRunStateOptions(): void {
    $options = TypeWorkflows::runStateOptions();
    $this->assertSame([
      'claimed' => 'Claimed',
      'running' => 'Running',
      'done' => 'Done',
      'expired' => 'Expired',
      'failed' => 'Failed',
      'cancelled' => 'Cancelled',
    ], $options);
  }

  /**
   * Asserts the run state facet processor plugin is discoverable.
   */
  public function testRunStateLabelProcessorIsDiscoverable(): void {
    $definitions = \Drupal::service('plugin.manager.facets.processor')->getDefinitions();
    $this->assertArrayHasKey('bb_run_state_label', $definitions);
  }

  /**
   * Verifies terminalTicketStates() keeps every state bound to its workflow.
   *
   * The map is per-workflow rather than a flat union of state names because
   * terminality is a per-workflow property: a workflow that later gains a
   * transition out of `done` must stop reporting `done` as terminal without
   * that affecting any other workflow (BB-311 D2).
   */
  public function testTerminalTicketStatesPairsEachWorkflowWithItsTerminalStates(): void {
    $terminal = TypeWorkflows::terminalTicketStates();

    foreach (['bb_work'] as $workflow_id) {
      $this->assertArrayHasKey($workflow_id, $terminal);
      $states = $terminal[$workflow_id];
      sort($states);
      $this->assertSame(['cancelled', 'done'], $states, $workflow_id);
    }

    // Bb_run is not in the bb_ticket workflow group, so its terminal states
    // (done, expired, failed) are absent by construction — the backfill must
    // never reason about run states.
    $this->assertArrayNotHasKey('bb_run', $terminal);

    // No workflow reports a state it can still leave.
    foreach ($terminal as $workflow_id => $states) {
      $this->assertNotContains('plan', $states, $workflow_id);
      $this->assertNotContains('working', $states, $workflow_id);
      $this->assertNotContains('review', $states, $workflow_id);
      $this->assertNotContains('qualification', $states, $workflow_id);
    }
  }

  /**
   * EVERY state of EVERY workflow declares a phase, and this enumerates them.
   *
   * THE ENUMERATION IS THE GUARD, and it is deliberately not a fallback.
   * `phase()` throws for a state that declares none, so this test is what
   * makes that exception unreachable in production: it walks the workflow
   * plugin manager rather than a list written here, so a new workflow —
   * or one more state on an existing one — is covered the moment it is
   * defined. A `?? 'prepare'` in `phase()` would have shipped that workflow
   * with a silently wrong phase and nothing anywhere would have said so.
   *
   * WHY BOTH AND NOT EITHER. The exception alone is loud at the wrong time —
   * a 500 on a listing page, and only for the states a reader happens to
   * reach. This test alone cannot exist without something to assert, because
   * a `phase()` that returned `''` for a missing key would make "no phase"
   * indistinguishable from a phase. So the exception is the mechanism and the
   * enumeration is the coverage.
   */
  public function testEveryStateOfEveryWorkflowDeclaresItsPhase(): void {
    $manager = $this->container->get('plugin.manager.workflow');
    $definitions = $manager->getDefinitions();

    // The three workflows this tree defines (the ticket workflow bb_work,
    // bb_run and the review comment's bb_review).
    // Asserted so that a fourth cannot arrive unnoticed: the phase table
    // below would then be incomplete and this count is what says so first.
    $this->assertSame([
      'bb_work', 'bb_run', 'bb_review',
    ], array_values(array_map('strval', array_keys($definitions))));

    $phases = [];
    foreach ($definitions as $workflow_id => $definition) {
      foreach (array_keys($definition['states'] ?? []) as $state) {
        $phase = TypeWorkflows::phase((string) $workflow_id, (string) $state);
        $this->assertContains($phase, TypeWorkflows::PHASES, sprintf(
          '%s.%s declares phase "%s".',
          $workflow_id,
          $state,
          $phase,
        ));
        $phases[(string) $workflow_id][(string) $state] = $phase;
      }
    }

    // The mapping as shipped, stated per workflow rather than as a union: a
    // state name is only meaningful inside its workflow, and a union would
    // hide the day two workflows disagree about one.
    $this->assertSame([
      'bb_work' => [
        'qualification' => 'prepare',
        'plan' => 'prepare',
        'working' => 'running',
        'review' => 'review',
        'done' => 'done',
        'cancelled' => 'cancelled',
      ],
      'bb_run' => [
        'claimed' => 'prepare',
        'running' => 'running',
        'done' => 'done',
        'expired' => 'done',
        'failed' => 'done',
        'cancelled' => 'cancelled',
      ],
      'bb_review' => [
        'draft' => 'prepare',
        'submitted' => 'review',
        'accepted' => 'done',
        'rejected' => 'cancelled',
      ],
    ], $phases);
  }

  /**
   * A state that declares no phase fails loudly rather than defaulting.
   *
   * Measured against a state that does not exist at all, which is the same
   * defect from `phase()`'s point of view — nothing in the definition names a
   * phase for it. The message names both the workflow and the state, because
   * the reader's next move is to open `bb_core.workflows.yml` at that line.
   */
  public function testStateWithNoPhaseThrows(): void {
    $this->expectException(\LogicException::class);
    $this->expectExceptionMessage('bb_work');
    TypeWorkflows::phase('bb_work', 'nonexistent');
  }

  /**
   * This class states no accent, and the deletion is asserted.
   *
   * `accentForPhase()` LIVED HERE FOR ONE DAY and went on 2026-09-04. It was a
   * presentation decision — five phases onto the two `bb_theme:table`
   * accents that answer one — sitting in a workflow reader, and the argument
   * that put it here (*"the one place phase meets the design system"*) is the
   * argument for putting it in the template that draws the rail. It now lives
   * in `views-view-table.html.twig`, and the rendered rail is asserted through
   * the markup by `TicketsViewTableTest`, which is where a wrong colour is
   * actually visible.
   *
   * THE ACCENT VOCABULARY IS STILL NARROWER THAN THE PHASE VOCABULARY, which
   * is why this was never a total function: `bb_theme:table` declares
   * `running | attention | wait | idle`; `wait` is documented as *"a ticket
   * nobody is acting on"* and `idle` renders the same transparent rail an
   * absent accent does. Neither answers a phase — in `prepare` somebody IS on
   * the hook, and `done`/`cancelled` are over — so three of the five phases
   * make the template omit the prop and the component draws its own
   * transparent rail.
   */
  public function testThisClassStatesNoPresentationAccent(): void {
    // ASKED THROUGH REFLECTION rather than `method_exists()`: the method is
    // provably absent, and static analysis reports such a call as always-false.
    $this->assertFalse(
      (new \ReflectionClass(TypeWorkflows::class))->hasMethod('accentForPhase'),
      'A phase-to-accent map is back in a workflow reader.',
    );
  }

}
