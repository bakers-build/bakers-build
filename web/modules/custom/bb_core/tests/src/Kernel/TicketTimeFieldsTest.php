<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the two accounted time fields a ticket carries.
 *
 * Both are proposed by an agent and confirmed by a human (BB-308 D1), so
 * neither is computed. The absence of a default is the load-bearing part: a
 * ticket nobody estimated has no estimate, which is a different statement from
 * "estimated at zero", and a default would erase that difference.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTimeFieldsTest extends KernelTestBase {

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
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * Both fields store integers without treating an unset estimate as zero.
   */
  public function testTimeFieldsAreIntegersWithoutDefaults(): void {
    $fields = $this->container->get('entity_field.manager')
      ->getBaseFieldDefinitions('bb_ticket');

    $this->assertArrayHasKey('time_estimate', $fields);
    $this->assertArrayHasKey('time_spent', $fields);
    $this->assertSame('integer', $fields['time_estimate']->getType());
    $this->assertSame('integer', $fields['time_spent']->getType());
    $this->assertSame([], $fields['time_estimate']->getDefaultValueLiteral());
    $this->assertSame([], $fields['time_spent']->getDefaultValueLiteral());
  }

  /**
   * Seconds round-trip through storage, and an unwritten field reads empty.
   */
  public function testSecondsRoundTripAndUnsetReadsEmpty(): void {
    $ticket = $this->createTicket();
    $this->assertTrue($ticket->get('time_estimate')->isEmpty());
    $this->assertTrue($ticket->get('time_spent')->isEmpty());

    $ticket->set('time_estimate', 14400)->set('time_spent', 39600)->save();

    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->loadUnchanged((int) $ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->assertSame(14400, (int) $reloaded->get('time_estimate')->value);
    $this->assertSame(39600, (int) $reloaded->get('time_spent')->value);
  }

  /**
   * The GitLab assignee field is retired; nothing writes it any more.
   */
  public function testGitlabAssigneeFieldIsAbsent(): void {
    $fields = $this->container->get('entity_field.manager')
      ->getBaseFieldDefinitions('bb_ticket');

    $this->assertArrayNotHasKey('gitlab_assignee_username', $fields);
  }

  /**
   * Creates a minimal saved ticket.
   */
  private function createTicket(): BbTicketInterface {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->create(['name' => 'Time fields']);
    $project->save();
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')->create([
        'title' => 'Time fields',
        'workflow' => 'bb_feature',
        'state' => 'qualification',
        'project_id' => $project->id(),
      ]);
    $ticket->save();
    assert($ticket instanceof BbTicketInterface);
    return $ticket;
  }

}
