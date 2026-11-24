<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Ticket tools mark service accounts among a ticket's people.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketServiceAccountToolTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'bb_core', 'tool',
    'serialization', 'consumers', 'simple_oauth', 'views', 'bb_api_key',
  ];

  /**
   * A service-account assignee is marked, so runs never take it for a person.
   */
  public function testServiceAccountAssigneeIsMarked(): void {
    $service = $this->container->get('entity_type.manager')->getStorage('user')->create([
      'name' => 'service-ci-aaaaaaaa',
      'status' => 1,
      'bb_service_workspace' => $this->workspace->id(),
    ]);
    $service->save();
    $ticket = $this->ticket('TR-service', [
      'assignee_user_id' => $service->id(),
      'reviewers' => [$this->actor->id()],
    ]);
    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->uuid()]));
    self::assertTrue($out['assignee']['service_account']);
    self::assertFalse($out['reviewers'][0]['service_account']);
  }

}
