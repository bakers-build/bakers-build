<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\state_machine\Plugin\Workflow\WorkflowInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the bb_work state machine every work ticket runs.
 *
 * Checks its exact states and transitions, that a new ticket starts in
 * qualification, and that valid transitions apply while invalid ones are
 * rejected.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketWorkflowTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // bb_run schema is required: every ticket state transition fires the
    // bb_core presave hook, which queries bb_run to close the prior run.
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Every work ticket runs bb_work; the old per-type workflows are gone.
   *
   * States and transitions are asserted exactly, so a new route cannot
   * arrive unnoticed.
   */
  public function testWorkWorkflowStatesAndTransitions(): void {
    $manager = $this->container->get('plugin.manager.workflow');
    $ticket_workflows = array_keys(array_filter(
      $manager->getDefinitions(),
      static fn (array $definition): bool => $definition['group'] === 'bb_ticket',
    ));
    $this->assertSame(['bb_work', 'bb_deployment', 'bb_verification'], $ticket_workflows);
    $work = $manager->createInstance('bb_work');
    $this->assertInstanceOf(WorkflowInterface::class, $work);
    $this->assertSame(
      ['qualification', 'plan', 'working', 'review', 'done', 'cancelled'],
      array_keys($work->getStates()),
    );
    $transitions = [];
    foreach ($work->getTransitions() as $id => $transition) {
      $transitions[$id] = [array_keys($transition->getFromStates()), $transition->getToState()->getId()];
    }
    $this->assertSame([
      'qualify' => [['qualification'], 'plan'],
      'requalify' => [['plan', 'working'], 'qualification'],
      'to_working' => [['qualification', 'plan', 'review'], 'working'],
      'to_plan' => [['working'], 'plan'],
      'to_review' => [['working'], 'review'],
      'finish' => [['working', 'review'], 'done'],
      'cancel' => [['qualification', 'plan', 'working', 'review'], 'cancelled'],
    ], $transitions);
  }

  /**
   * A new work ticket starts in qualification on bb_work.
   */
  public function testNewWorkTicketStartsInQualification(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-1',
      'workflow' => 'bb_work',
      'title' => 'Crash',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $this->assertSame('qualification', $ticket->get('state')->value);
    $workflow = $ticket->getState()->getWorkflow();
    $this->assertInstanceOf(WorkflowInterface::class, $workflow);
    $this->assertSame('bb_work', $workflow->getId());
  }

  /**
   * The standard path qualification → plan → working → review → done applies.
   */
  public function testStandardPathApplies(): void {
    $ticket = $this->createWorkTicket('GL-3');
    foreach (['qualify' => 'plan', 'to_working' => 'working', 'to_review' => 'review', 'finish' => 'done'] as $transition => $state) {
      $ticket->getState()->applyTransitionById($transition);
      $ticket->save();
      $this->assertSame($state, $ticket->get('state')->value);
    }
  }

  /**
   * Working may return to plan, requalify and finish without review.
   */
  public function testWorkingRecoveryAndOptionalReview(): void {
    $ticket = $this->createWorkTicket('GL-RQ1');
    $steps = [
      ['to_working', 'working'],
      ['to_plan', 'plan'],
      ['to_working', 'working'],
      ['requalify', 'qualification'],
    ];
    foreach ($steps as [$transition, $state]) {
      $ticket->getState()->applyTransitionById($transition);
      $ticket->save();
      $this->assertSame($state, $ticket->get('state')->value);
    }
    $ticket->getState()->applyTransitionById('to_working');
    $ticket->getState()->applyTransitionById('finish');
    $ticket->save();
    $this->assertSame('done', $ticket->get('state')->value);
  }

  /**
   * Review cannot requalify; the rejected transition leaves the state.
   */
  public function testRequalifyFromReviewRejected(): void {
    $ticket = $this->createWorkTicket('GL-RQ2');
    $ticket->getState()->applyTransitionById('to_working');
    $ticket->getState()->applyTransitionById('to_review');
    $ticket->save();
    try {
      $ticket->getState()->applyTransitionById('requalify');
      $this->fail('Expected requalify from review to be rejected.');
    }
    catch (\Throwable) {
      $this->assertSame('review', $ticket->get('state')->value);
    }
  }

  /**
   * An unclassified ticket persists with no workflow and no state.
   */
  public function testUnclassifiedTicketHasNoWorkflowOrState(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-5',
      'title' => 'Unknown',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $this->assertSame('', (string) $ticket->get('workflow')->value);
    $this->assertTrue($ticket->get('state')->isEmpty());
  }

  /**
   * Verifies that an unavailable transition is rejected without state changes.
   */
  public function testInvalidTransitionRejected(): void {
    $ticket = $this->createWorkTicket('GL-4');
    try {
      $ticket->getState()->applyTransitionById('finish');
      $this->fail('Expected unavailable finish transition to be rejected.');
    }
    catch (\Throwable) {
      $this->assertSame('qualification', $ticket->get('state')->value);
    }
  }

  /**
   * Cancelled is a terminal ticket state; expired/failed are terminal for runs.
   *
   * No ticket workflow may list cancelled as a from-state. bb_run must not
   * expose any transition that leaves expired or failed.
   */
  public function testCancelledHasNoOutgoingTransitions(): void {
    $manager = $this->container->get('plugin.manager.workflow');
    $ticket_workflows = [
      'bb_work',
      'bb_deployment',
      'bb_verification',
    ];
    foreach ($ticket_workflows as $id) {
      $this->assertTrue($manager->hasDefinition($id), "workflow $id missing");
      $workflow = $manager->createInstance($id);
      $this->assertInstanceOf(WorkflowInterface::class, $workflow);
      foreach ($workflow->getTransitions() as $transition_id => $transition) {
        $this->assertArrayNotHasKey(
          'cancelled',
          $transition->getFromStates(),
          "$id transition $transition_id must not leave cancelled",
        );
      }
      $this->assertSame(
        [],
        $workflow->getPossibleTransitions('cancelled'),
        "$id must have no possible transitions from cancelled",
      );
    }

    $run = $manager->createInstance('bb_run');
    $this->assertInstanceOf(WorkflowInterface::class, $run);
    foreach (['expired', 'failed'] as $terminal) {
      $this->assertSame(
        [],
        $run->getPossibleTransitions($terminal),
        "bb_run must have no possible transitions from $terminal",
      );
      foreach ($run->getTransitions() as $transition_id => $transition) {
        $this->assertArrayNotHasKey(
          $terminal,
          $transition->getFromStates(),
          "bb_run transition $transition_id must not leave $terminal",
        );
      }
    }
  }

  /**
   * Creates and saves a bb_work ticket in qualification.
   */
  private function createWorkTicket(string $identifier): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => $identifier,
      'workflow' => 'bb_work',
      'title' => $identifier,
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

}
