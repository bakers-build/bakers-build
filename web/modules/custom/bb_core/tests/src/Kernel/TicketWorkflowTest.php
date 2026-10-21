<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\state_machine\Plugin\Workflow\WorkflowInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the per-type state-machine workflows for bakers.build tickets.
 *
 * Checks that bb_bug, bb_feature, bb_chore and bb_epic workflows
 * are registered with the correct states, that a new ticket starts in
 * its first work state
 * with the right workflow, and that valid transitions are applied while
 * invalid ones are rejected.
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
   * Verifies that all three type-specific workflow plugins are registered.
   *
   * Also checks that each workflow exposes the correct type-specific states.
   */
  public function testTypeWorkflowsExist(): void {
    $manager = $this->container->get('plugin.manager.workflow');
    foreach (['bb_bug', 'bb_feature', 'bb_chore', 'bb_epic'] as $id) {
      $this->assertTrue($manager->hasDefinition($id), "workflow $id missing");
    }
    $feature = $manager->createInstance('bb_feature');
    $bug = $manager->createInstance('bb_bug');
    $chore = $manager->createInstance('bb_chore');
    $epic = $manager->createInstance('bb_epic');
    $this->assertInstanceOf(WorkflowInterface::class, $feature);
    $this->assertInstanceOf(WorkflowInterface::class, $bug);
    $this->assertInstanceOf(WorkflowInterface::class, $chore);
    $this->assertInstanceOf(WorkflowInterface::class, $epic);
    // Qualification is the first state of every work workflow (BB-196).
    $this->assertNotNull($feature->getState('qualification'));
    $this->assertNotNull($bug->getState('qualification'));
    $this->assertNotNull($chore->getState('qualification'));
    $this->assertNotNull($epic->getState('qualification'));
    $this->assertNotNull($epic->getState('spec'));
    $this->assertNotNull($epic->getState('active'));
    $this->assertNull($epic->getState('coding'));
    $this->assertNotNull($epic->getState('review'));
    $this->assertNotNull($feature->getState('spec'));
    $this->assertNotNull($feature->getState('review'));
    $this->assertNull($feature->getState('human_input'));
    $this->assertNull($feature->getState('customer_review'));
    $this->assertNotNull($bug->getState('diagnose'));
    $this->assertNull($bug->getState('spec'));
    $this->assertNull($bug->getState('human_input'));
    $this->assertNull($bug->getState('backlog'));
    $this->assertNull($bug->getState('todo'));
    $this->assertNull($feature->getState('todo'));
    $this->assertNull($chore->getState('todo'));
    $this->assertNotNull($bug->getState('diagnose'));
    // BB-444: `qualification` joins `to_coding`'s from-states in all three
    // work workflows, so a fully specified intake may route straight to
    // `coding`.
    $this->assertSame(['diagnose', 'review', 'qualification'], array_keys($bug->getTransition('to_coding')->getFromStates()));
    $this->assertSame('coding', $bug->getTransition('to_coding')->getToState()->getId());
    $this->assertSame(['spec', 'review', 'qualification'], array_keys($feature->getTransition('to_coding')->getFromStates()));
    $this->assertSame('coding', $feature->getTransition('to_coding')->getToState()->getId());
    $this->assertSame(['spec', 'review', 'qualification'], array_keys($chore->getTransition('to_coding')->getFromStates()));
    $this->assertSame('coding', $chore->getTransition('to_coding')->getToState()->getId());
    $this->assertSame(['spec', 'review', 'qualification'], array_keys($epic->getTransition('to_active')->getFromStates()));
    $this->assertSame('active', $epic->getTransition('to_active')->getToState()->getId());
    $this->assertSame(['active'], array_keys($epic->getTransition('to_review')->getFromStates()));
    $this->assertSame('review', $epic->getTransition('to_review')->getToState()->getId());
    $this->assertSame(['review'], array_keys($epic->getTransition('finish')->getFromStates()));
    $this->assertSame('done', $epic->getTransition('finish')->getToState()->getId());
    $this->assertSame(['spec', 'active'], array_keys($epic->getTransition('requalify')->getFromStates()));
    // BB-469 D3: coding must offer a route back to diagnose without
    // dropping an intact qualification handoff (requalify goes to
    // qualification instead).
    $this->assertSame(['coding'], array_keys($bug->getTransition('to_diagnose')->getFromStates()));
    $this->assertSame('diagnose', $bug->getTransition('to_diagnose')->getToState()->getId());
    // Bug/chore: finish may leave coding or review (optional review, BB-354).
    $this->assertSame(['review', 'coding'], array_keys($bug->getTransition('finish')->getFromStates()));
    $this->assertSame('done', $bug->getTransition('finish')->getToState()->getId());
    $this->assertSame(['review', 'coding'], array_keys($chore->getTransition('finish')->getFromStates()));
    $this->assertSame('done', $chore->getTransition('finish')->getToState()->getId());
    // Feature: review remains mandatory before done.
    $this->assertSame(['review'], array_keys($feature->getTransition('finish')->getFromStates()));
    $this->assertSame('done', $feature->getTransition('finish')->getToState()->getId());
    $this->assertNotNull($chore->getState('review'));
    $this->assertNull($chore->getState('human_input'));

    // qualify: qualification to spec (feature/chore) or diagnose (bug).
    $this->assertSame(['qualification'], array_keys($feature->getTransition('qualify')->getFromStates()));
    $this->assertSame('spec', $feature->getTransition('qualify')->getToState()->getId());
    $this->assertSame('spec', $chore->getTransition('qualify')->getToState()->getId());
    $this->assertSame(['qualification'], array_keys($bug->getTransition('qualify')->getFromStates()));
    $this->assertSame('diagnose', $bug->getTransition('qualify')->getToState()->getId());

    // requalify: the guard's recovery route back; review is excluded.
    $this->assertSame(['spec', 'coding'], array_keys($feature->getTransition('requalify')->getFromStates()));
    $this->assertSame('qualification', $feature->getTransition('requalify')->getToState()->getId());
    $this->assertSame(['diagnose', 'coding'], array_keys($bug->getTransition('requalify')->getFromStates()));
    $this->assertSame('qualification', $bug->getTransition('requalify')->getToState()->getId());
    $this->assertArrayNotHasKey('review', $feature->getTransition('requalify')->getFromStates());
    $this->assertArrayNotHasKey('review', $bug->getTransition('requalify')->getFromStates());
  }

  /**
   * Verifies a new ticket starts in its first work state for its workflow.
   *
   * The first work state of every work workflow is `qualification` (BB-196):
   * a classified ticket enters qualification before spec/diagnose work.
   */
  public function testTicketStateWorkflowFollowsType(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $bug = $storage->create(['identifier' => 'GL-1', 'workflow' => 'bb_bug', 'title' => 'Crash']);
    $this->assertInstanceOf(BbTicketInterface::class, $bug);
    $bug->save();
    $this->assertSame('qualification', $bug->get('state')->value);
    $bug_workflow = $bug->getState()->getWorkflow();
    $this->assertInstanceOf(WorkflowInterface::class, $bug_workflow);
    $this->assertSame('bb_bug', $bug_workflow->getId());

    $feature = $storage->create(['identifier' => 'GL-2', 'workflow' => 'bb_feature', 'title' => 'New thing']);
    $this->assertInstanceOf(BbTicketInterface::class, $feature);
    $feature->save();
    $this->assertSame('qualification', $feature->get('state')->value);
    $feature_workflow = $feature->getState()->getWorkflow();
    $this->assertInstanceOf(WorkflowInterface::class, $feature_workflow);
    $this->assertSame('bb_feature', $feature_workflow->getId());
  }

  /**
   * Verifies the qualify → work-state → coding transition chain applies.
   */
  public function testValidTransitionApplies(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-3',
      'workflow' => 'bb_bug',
      'title' => 'X',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $this->assertSame('qualification', $ticket->get('state')->value);
    // qualify: qualification → diagnose.
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $this->assertSame('diagnose', $ticket->get('state')->value);
    // to_coding: diagnose → coding.
    $ticket->getState()->applyTransitionById('to_coding');
    $ticket->save();
    $this->assertSame('coding', $ticket->get('state')->value);
  }

  /**
   * Verifies the requalify recovery route and its review exclusion.
   *
   * The guard bounces spec/diagnose/coding back to qualification via
   * `requalify`; review must NOT be able to requalify (BB-196).
   */
  public function testRequalifyRoutesBackButNotFromReview(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');

    // Coding → requalify → qualification.
    $bug = $storage->create(['identifier' => 'GL-RQ1', 'workflow' => 'bb_bug', 'title' => 'X']);
    $this->assertInstanceOf(BbTicketInterface::class, $bug);
    $bug->save();
    $bug->getState()->applyTransitionById('qualify');
    $bug->save();
    $bug->getState()->applyTransitionById('to_coding');
    $bug->save();
    $this->assertSame('coding', $bug->get('state')->value);
    $bug->getState()->applyTransitionById('requalify');
    $bug->save();
    $this->assertSame('qualification', $bug->get('state')->value);

    // Review → qualification is rejected (requalify excludes review).
    $feature = $storage->create(['identifier' => 'GL-RQ2', 'workflow' => 'bb_feature', 'title' => 'Y']);
    $this->assertInstanceOf(BbTicketInterface::class, $feature);
    $feature->save();
    $feature->getState()->applyTransitionById('qualify');
    $feature->save();
    $feature->getState()->applyTransitionById('to_coding');
    $feature->save();
    $feature->getState()->applyTransitionById('to_review');
    $feature->save();
    $this->assertSame('review', $feature->get('state')->value);
    try {
      $feature->getState()->applyTransitionById('requalify');
      $this->fail('Expected requalify from review to be rejected.');
    }
    catch (\Throwable) {
      $this->assertSame('review', $feature->get('state')->value);
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
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-4',
      'workflow' => 'bb_bug',
      'title' => 'X',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $before = $ticket->get('state')->value;
    try {
      $ticket->getState()->applyTransitionById('finish');
      $this->fail('Expected unavailable finish transition to be rejected.');
    }
    catch (\Throwable) {
      $this->assertSame($before, $ticket->get('state')->value);
    }
  }

  /**
   * Chore and bug may finish from coding (optional review).
   *
   * Small work should be able to reach done without a mandatory review stop.
   * Feature remains review-mandatory
   * (see testFinishFromCodingRejectedForFeature).
   */
  public function testFinishFromCodingSucceedsForChoreAndBug(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');

    foreach (['bb_chore' => 'GL-FIN-CHORE', 'bb_bug' => 'GL-FIN-BUG'] as $workflow => $identifier) {
      $ticket = $storage->create([
        'identifier' => $identifier,
        'workflow' => $workflow,
        'title' => $identifier,
      ]);
      $this->assertInstanceOf(BbTicketInterface::class, $ticket);
      $ticket->save();
      $ticket->getState()->applyTransitionById('qualify');
      $ticket->save();
      $ticket->getState()->applyTransitionById('to_coding');
      $ticket->save();
      $this->assertSame('coding', $ticket->get('state')->value, "$workflow should be in coding before finish");

      $ticket->getState()->applyTransitionById('finish');
      $ticket->save();
      $this->assertSame('done', $ticket->get('state')->value, "$workflow finish from coding must land in done");
    }
  }

  /**
   * Features must still pass through review before finish.
   */
  public function testFinishFromCodingRejectedForFeature(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-FIN-FEAT',
      'workflow' => 'bb_feature',
      'title' => 'Feature stays review-mandatory',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $ticket->getState()->applyTransitionById('to_coding');
    $ticket->save();
    $this->assertSame('coding', $ticket->get('state')->value);

    try {
      $ticket->getState()->applyTransitionById('finish');
      $this->fail('Expected finish from coding to be rejected for bb_feature.');
    }
    catch (\Throwable) {
      $this->assertSame('coding', $ticket->get('state')->value);
    }
  }

  /**
   * Epics must pass through review before finish; active is not coding.
   */
  public function testFinishFromActiveRejectedForEpic(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-FIN-EPIC',
      'workflow' => 'bb_epic',
      'title' => 'Epic stays review-mandatory',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $ticket->getState()->applyTransitionById('to_active');
    $ticket->save();
    $this->assertSame('active', $ticket->get('state')->value);

    try {
      $ticket->getState()->applyTransitionById('finish');
      $this->fail('Expected finish from active to be rejected for bb_epic.');
    }
    catch (\Throwable) {
      $this->assertSame('active', $ticket->get('state')->value);
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
      'bb_feature',
      'bb_bug',
      'bb_chore',
      'bb_epic',
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

}
