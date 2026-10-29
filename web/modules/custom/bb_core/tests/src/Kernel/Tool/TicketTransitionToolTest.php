<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A transition through its tool follows the workflow and appends links.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTransitionToolTest extends BakersToolTestBase {

  /**
   * Moves the ticket and appends links, keeping the existing ones.
   */
  public function testTransitionAppendsLinks(): void {
    $ticket = $this->ticket('TT-1', [
      'links' => [['uri' => 'https://example.com/a', 'title' => 'A']],
    ]);
    $out = $this->outputs($this->runTool('bakers_ticket_transition', [
      'ticket' => $ticket->getIdentifier(),
      'state' => 'plan',
      'links' => [
        ['uri' => 'https://example.com/b', 'title' => 'B'],
        ['uri' => 'https://example.com/a', 'title' => 'A'],
      ],
    ]));
    self::assertSame('plan', $out['state']);
    $uris = array_column($out['links'], 'uri');
    self::assertSame(['https://example.com/a', 'https://example.com/b'], $uris);
    $stored = $this->reload($ticket);
    self::assertSame('plan', $stored->get('state')->value);
    self::assertSame($uris, array_column($stored->get('links')->getValue(), 'uri'));
  }

  /**
   * A transition the workflow refuses names both states and saves nothing.
   */
  public function testRefusedTransitionNamesBothStates(): void {
    $ticket = $this->ticket('TT-2');
    $this->assertFailure($this->runTool('bakers_ticket_transition', [
      'ticket' => $ticket->getIdentifier(),
      'state' => 'done',
    ]), 'from qualification to done');
    $stored = $this->reload($ticket);
    self::assertSame('qualification', $stored->get('state')->value);
  }

  /**
   * A reader without update access cannot move the ticket.
   */
  public function testReaderWithoutUpdateAccessFails(): void {
    $ticket = $this->ticket('TT-3');
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'viewer', 'label' => 'Viewer'])->save();
    user_role_grant_permissions('viewer', ['view bb_ticket', 'view bb_project']);
    $reader = $this->account('reader', ['viewer']);
    foreach ($etm->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $reader);
    }
    $this->container->get('current_user')->setAccount($reader);
    self::assertSame('TT-3', $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]))['title']);
    $this->assertFailure($this->runTool('bakers_ticket_transition', [
      'ticket' => $ticket->getIdentifier(),
      'state' => 'plan',
    ]), $ticket->getIdentifier());
  }

}
