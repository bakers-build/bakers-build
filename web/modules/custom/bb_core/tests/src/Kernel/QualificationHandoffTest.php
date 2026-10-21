<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the qualification hand-off: classifying an unclassified ticket.
 *
 * A qualification agent sets both `workflow` and `state` on a previously
 * unclassified ticket (empty workflow + empty state). This is an initial state
 * assignment for the new workflow, not a cross-workflow transition — no prior
 * state exists to transition from. The entity-level save must succeed without a
 * state_machine transition error.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class QualificationHandoffTest extends KernelTestBase {

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
   * Verifies a qualification agent can classify an unclassified ticket.
   *
   * An unclassified ticket starts with no workflow and no state. Setting both
   * workflow and an initial state for that workflow must succeed at the entity
   * level — this is not a transition from a prior state, it is a first
   * classification.
   */
  public function testHandoffSetsWorkflowAndState(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');

    // Create an unclassified ticket (no workflow, no state).
    $ticket = $storage->create([
      'identifier' => 'GL-H',
      'title' => 'X',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();

    // Confirm unclassified baseline.
    $this->assertSame('', (string) $ticket->get('workflow')->value);
    $this->assertTrue($ticket->get('state')->isEmpty());

    // Qualification hand-off: classify the ticket.
    $ticket->set('workflow', 'bb_bug');
    $ticket->set('state', 'diagnose');
    $ticket->save();

    // Reload from storage to confirm persistence.
    $storage->resetCache([$ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->assertSame('bb_bug', (string) $reloaded->get('workflow')->value);
    $this->assertSame('diagnose', $reloaded->get('state')->value);
  }

  /**
   * Verifies that the bb_feature workflow can also be assigned on hand-off.
   *
   * Ensures that qualification is not limited to bb_bug — any registered
   * workflow can be initially assigned.
   */
  public function testHandoffWorksForFeatureWorkflow(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');

    $ticket = $storage->create([
      'identifier' => 'GL-H2',
      'title' => 'Feature request',
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();

    $ticket->set('workflow', 'bb_feature');
    $ticket->set('state', 'spec');
    $ticket->save();

    $storage->resetCache([$ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->assertSame('bb_feature', (string) $reloaded->get('workflow')->value);
    $this->assertSame('spec', $reloaded->get('state')->value);
  }

}
