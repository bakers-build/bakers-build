<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the bb_ticket `priority` field is a constrained three-level list.
 *
 * The field advertises a static allowed_values map {1: High, 2: Medium,
 * 3: Low} (High most urgent, mirroring the dispatch-ordering "priority asc,
 * null last" semantics). Values outside {1,2,3} must fail entity validation;
 * 1/2/3 and null (no priority) must pass.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class PriorityFieldTest extends KernelTestBase {

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
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * The priority field advertises the three-level allowed_values map.
   */
  public function testAllowedValuesMap(): void {
    $definitions = $this->container->get('entity_field.manager')
      ->getBaseFieldDefinitions('bb_ticket');
    $priority = $definitions['priority'];
    $this->assertSame(
      [1 => 'High', 2 => 'Medium', 3 => 'Low'],
      $priority->getSetting('allowed_values'),
    );
  }

  /**
   * Values 1/2/3 and null validate; anything else is rejected.
   */
  public function testPriorityValidation(): void {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->create(['name' => 'P']);
    $project->save();

    // Allowed levels and "no priority" (null) validate.
    foreach ([1, 2, 3, NULL] as $value) {
      $ticket = $this->createTicket($project->id(), $value);
      $violations = $ticket->get('priority')->validate();
      $label = $value === NULL ? 'null' : (string) $value;
      $this->assertCount(0, $violations, "priority {$label} should validate");
    }

    // A value outside the allowed set is rejected.
    $ticket = $this->createTicket($project->id(), 4);
    $violations = $ticket->get('priority')->validate();
    $this->assertGreaterThan(0, $violations->count(), 'priority 4 should be rejected');
  }

  /**
   * Creates an unsaved bb_ticket with the given priority.
   */
  private function createTicket(int|string $project_id, ?int $priority): BbTicketInterface {
    $values = [
      'title' => 'Priority ticket',
      'project_id' => $project_id,
      'workflow' => 'bb_feature',
    ];
    if ($priority !== NULL) {
      $values['priority'] = $priority;
    }
    /** @var \Drupal\bb_core\Entity\BbTicketInterface $ticket */
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')->create($values);
    return $ticket;
  }

}
