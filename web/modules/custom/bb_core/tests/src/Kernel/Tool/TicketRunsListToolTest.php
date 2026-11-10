<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket's runs through their tool: newest first, paged, read-scoped.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketRunsListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    user_role_grant_permissions('skill_user', ['view bb_run']);
  }

  /**
   * The tool takes a ticket and paging, nothing else.
   */
  public function testInputAllowlist(): void {
    $tool = $this->container->get('plugin.manager.tool')->createInstance('bakers_ticket_runs_list');
    self::assertSame(['ticket', 'limit', 'offset'], array_keys($tool->getInputDefinitions()));
  }

  /**
   * Runs of the ticket only, newest first, with the failure reason; paged.
   */
  public function testListsTheTicketsRunsNewestFirst(): void {
    $ticket = $this->ticket('RL-1');
    $first = $this->seedRun($ticket, [
      'state' => 'done',
      'closed' => TRUE,
      'started_at' => 1700000000,
      'agent' => 'claude',
      'state_at_start' => 'implementation',
    ]);
    $second = $this->seedRun($ticket, [
      'state' => 'failed',
      'error_log' => 'conductor restart: agent codex has no session resume',
    ]);
    $third = $this->seedRun($ticket, ['state' => 'running']);
    $this->seedRun($this->ticket('RL-2'), ['state' => 'running']);

    $out = $this->outputs($this->runTool('bakers_ticket_runs_list', ['ticket' => $ticket->getIdentifier(), 'limit' => 2]));
    self::assertSame([$third->uuid(), $second->uuid()], array_column($out['runs'], 'uuid'));
    self::assertSame([NULL, 'conductor restart: agent codex has no session resume'], array_column($out['runs'], 'error_log'));
    self::assertSame(2, $out['next_offset']);

    $out = $this->outputs($this->runTool('bakers_ticket_runs_list', ['ticket' => $ticket->uuid(), 'offset' => 2]));
    self::assertNull($out['next_offset']);
    self::assertSame([
      [
        'uuid' => $first->uuid(),
        'state' => 'done',
        'state_at_start' => 'implementation',
        'agent' => 'claude',
        'conductor' => $first->get('conductor_id')->entity->uuid(),
        'started_at' => 1700000000,
        'closed' => TRUE,
        'error_log' => NULL,
      ],
    ], $out['runs']);
  }

  /**
   * An outsider cannot read the ticket, so sees none of its runs.
   */
  public function testOutsiderIsRefused(): void {
    $ticket = $this->ticket('RL-3');
    $this->seedRun($ticket, ['state' => 'running']);
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    $this->assertFailure($this->runTool('bakers_ticket_runs_list', ['ticket' => $ticket->getIdentifier()]), 'does not exist or is not readable');
  }

  /**
   * Another workspace's contributor sees none of this ticket's runs.
   */
  public function testForeignContributorIsRefused(): void {
    $ticket = $this->ticket('RL-4');
    $this->seedRun($ticket, ['state' => 'running']);
    $this->foreignWorkspace();
    $this->assertFailure($this->runTool('bakers_ticket_runs_list', ['ticket' => $ticket->getIdentifier()]), 'does not exist or is not readable');
  }

  /**
   * Creates a run of the ticket on a fresh conductor of the project.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param array<string, mixed> $values
   *   Run field values.
   */
  private function seedRun(BbTicketInterface $ticket, array $values): BbRunInterface {
    $etm = $this->container->get('entity_type.manager');
    $name = 'node-' . $this->randomMachineName();
    $conductor = $etm->getStorage('bb_conductor')->create([
      'conductor_id' => $name,
      'label' => $name,
      'owner_user_id' => $this->actor->id(),
      'status' => 'online',
      'project_id' => $this->project->id(),
    ]);
    $conductor->save();
    $values += ['ticket_id' => $ticket->id(), 'conductor_id' => $conductor->id()];
    $run = $etm->getStorage('bb_run')->create($values);
    assert($run instanceof BbRunInterface);
    $run->save();
    return $run;
  }

}
