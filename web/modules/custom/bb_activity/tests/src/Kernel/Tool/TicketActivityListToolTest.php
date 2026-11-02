<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel\Tool;

use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use Drupal\Tests\bb_core\Kernel\Tool\ForeignWorkspaceTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket's or project's activities through their tool, newest first.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class TicketActivityListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['bb_activity'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_activity');
    $this->installEntitySchema('bb_notification_setting');
  }

  /**
   * The tool takes a ticket or a project and paging, nothing else.
   */
  public function testInputAllowlist(): void {
    $tool = $this->container->get('plugin.manager.tool')->createInstance('bakers_ticket_activity_list');
    self::assertSame(['ticket', 'project', 'limit', 'offset'], array_keys($tool->getInputDefinitions()));
  }

  /**
   * A ticket's events carry kind, actor, ticket and the feed statement.
   */
  public function testListsTheTicketsEvents(): void {
    $ticket = $this->ticket('AL-1');
    $this->ticket('AL-2');

    $out = $this->outputs($this->runTool('bakers_ticket_activity_list', ['ticket' => $ticket->getIdentifier()]));
    self::assertCount(1, $out['events']);
    $event = $out['events'][0];
    self::assertSame(['uuid', 'kind', 'created', 'actor', 'ticket', 'message'], array_keys($event));
    self::assertSame('created', $event['kind']);
    self::assertSame('actor', $event['actor']);
    self::assertSame($ticket->getIdentifier(), $event['ticket']);
    self::assertStringStartsWith('created', (string) $event['message']);
    self::assertIsInt($event['created']);
    self::assertNull($out['next_offset']);
  }

  /**
   * A project's events, newest first, paged.
   */
  public function testListsTheProjectsEventsNewestFirst(): void {
    $project = $this->project->uuid();
    $older = $this->ticket('AL-3');
    $newer = $this->ticket('AL-4');

    $out = $this->outputs($this->runTool('bakers_ticket_activity_list', ['project' => $project, 'limit' => 1]));
    self::assertSame([$newer->getIdentifier()], array_column($out['events'], 'ticket'));
    self::assertSame(1, $out['next_offset']);
    $out = $this->outputs($this->runTool('bakers_ticket_activity_list', ['project' => $project, 'offset' => 1]));
    self::assertSame([$older->getIdentifier()], array_column($out['events'], 'ticket'));
    self::assertNull($out['next_offset']);
  }

  /**
   * Exactly one of ticket and project.
   */
  public function testNeedsExactlyOneScope(): void {
    $ticket = $this->ticket('AL-5');
    $both = ['ticket' => $ticket->getIdentifier(), 'project' => $this->project->uuid()];
    $this->assertFailure($this->runTool('bakers_ticket_activity_list', $both), 'exactly one');
    $this->assertFailure($this->runTool('bakers_ticket_activity_list', []), 'exactly one');
  }

  /**
   * An outsider reads neither the ticket nor the project.
   */
  public function testOutsiderSeesNothing(): void {
    $ticket = $this->ticket('AL-6');
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    $this->assertFailure($this->runTool('bakers_ticket_activity_list', ['ticket' => $ticket->getIdentifier()]), 'does not exist or is not readable');
    $this->assertFailure($this->runTool('bakers_ticket_activity_list', ['project' => $this->project->uuid()]), 'does not exist or is not readable');
  }

  /**
   * Another workspace's contributor reads neither the ticket nor the project.
   */
  public function testForeignContributorSeesNothing(): void {
    $ticket = $this->ticket('AL-7');
    $this->foreignWorkspace();
    $this->assertFailure($this->runTool('bakers_ticket_activity_list', ['ticket' => $ticket->getIdentifier()]), 'does not exist or is not readable');
    $this->assertFailure($this->runTool('bakers_ticket_activity_list', ['project' => $this->project->uuid()]), 'does not exist or is not readable');
  }

}
