<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A project's readable tickets, closed ones included, page by page.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketListToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Every ticket of the project, with exactly the poller's fields.
   */
  public function testListsEveryReadableTicketWithFields(): void {
    $frozenAt = 1767225600;
    $parent = $this->ticket('PAR-1', [
      'labels' => [$this->term('label', 'pingpong')->id(), $this->term('label', 'question')->id()],
      'links' => [['uri' => 'https://example.slack.com/archives/C1/p1', 'title' => 'Thread']],
      'frozen' => TRUE,
      'frozen_at' => $frozenAt,
    ]);
    $child = $this->ticket('CH-1', ['parent_id' => $parent->id()]);
    $closed = $this->ticket('DONE-1');
    $closed->markClosed(1767225600)->save();

    $out = $this->outputs($this->runTool('bakers_ticket_list', ['project' => $this->project->uuid()]));
    self::assertNull($out['next_offset']);
    $rows = $out['tickets'];
    self::assertSame(
      [$parent->uuid(), $child->uuid(), $closed->uuid()],
      array_column($rows, 'id'),
    );

    self::assertSame(
      ['id', 'identifier', 'title', 'state', 'links', 'labels', 'frozen', 'frozen_at', 'parent', 'closed'],
      array_keys($rows[0]),
    );
    self::assertSame($parent->getIdentifier(), $rows[0]['identifier']);
    self::assertSame('PAR-1', $rows[0]['title']);
    self::assertSame('qualification', $rows[0]['state']);
    self::assertSame([['uri' => 'https://example.slack.com/archives/C1/p1', 'title' => 'Thread']], $rows[0]['links']);
    self::assertSame(['pingpong', 'question'], $rows[0]['labels']);
    self::assertTrue($rows[0]['frozen']);
    self::assertIsString($rows[0]['frozen_at']);
    self::assertSame($frozenAt, (new \DateTimeImmutable($rows[0]['frozen_at']))->getTimestamp());
    self::assertNull($rows[0]['parent']);
    self::assertFalse($rows[0]['closed']);

    self::assertSame($rows[0]['id'], $rows[1]['parent']);
    self::assertFalse($rows[1]['frozen']);
    self::assertNull($rows[1]['frozen_at']);
    self::assertSame([], $rows[1]['labels']);
    self::assertSame([], $rows[1]['links']);

    self::assertTrue($rows[2]['closed']);
  }

  /**
   * Walking the pages returns every ticket once, oldest first.
   */
  public function testPagesCoverEveryTicketOnceInStableOrder(): void {
    $expected = [];
    foreach (['T-1', 'T-2', 'T-3', 'T-4', 'T-5'] as $title) {
      $expected[] = $this->ticket($title)->uuid();
    }
    $project = $this->project->uuid();
    $seen = [];
    $offsets = [];
    $offset = 0;
    do {
      $out = $this->outputs($this->runTool('bakers_ticket_list', [
        'project' => $project,
        'limit' => 2,
        'offset' => $offset,
      ]));
      $seen = [...$seen, ...array_column($out['tickets'], 'id')];
      $offsets[] = $out['next_offset'];
      $offset = $out['next_offset'];
    } while ($offset !== NULL);

    self::assertSame([2, 4, NULL], $offsets);
    self::assertSame($expected, $seen);

    foreach ([['limit' => 0], ['limit' => 101], ['offset' => -1]] as $paging) {
      $this->assertFailure($this->runTool('bakers_ticket_list', ['project' => $project] + $paging), 'limit must be 1-100 and offset 0 or more.');
    }
  }

  /**
   * Unreadable tickets are absent; an unreadable project is refused by name.
   */
  public function testUnreadableTicketsAndProjectsAreRefused(): void {
    $this->ticket('Visible');
    [$workspace] = $this->foreignWorkspace();
    $group = $this->entity('bb_group', ['name' => 'foreign-group', 'workspace_id' => $workspace->id()]);
    $foreign = $this->entity('bb_project', ['name' => 'foreign-project', 'group_id' => $group->id()]);
    $this->ticket('Foreign', ['project_id' => $foreign->id()]);

    // The stranger reads its own project, never the actor's.
    $own = $this->outputs($this->runTool('bakers_ticket_list', ['project' => $foreign->uuid()]));
    self::assertSame(['Foreign'], array_column($own['tickets'], 'title'));
    $this->assertFailure(
      $this->runTool('bakers_ticket_list', ['project' => $this->project->uuid()]),
      sprintf('Project %s does not exist or is not readable.', $this->project->uuid()),
    );

    // The actor sees nothing of the stranger's project.
    $this->container->get('current_user')->setAccount($this->actor);
    $this->assertFailure(
      $this->runTool('bakers_ticket_list', ['project' => $foreign->uuid()]),
      sprintf('Project %s does not exist or is not readable.', $foreign->uuid()),
    );
    $unknown = '00000000-0000-4000-8000-000000000000';
    $this->assertFailure(
      $this->runTool('bakers_ticket_list', ['project' => $unknown]),
      sprintf('Project %s does not exist or is not readable.', $unknown),
    );
  }

  /**
   * A parent in a project the caller cannot read stays hidden.
   */
  public function testParentTheCallerCannotReadIsEmpty(): void {
    [$workspace] = $this->foreignWorkspace();
    $group = $this->entity('bb_group', ['name' => 'foreign-group', 'workspace_id' => $workspace->id()]);
    $foreign = $this->entity('bb_project', ['name' => 'foreign-project', 'group_id' => $group->id()]);
    $hidden = $this->ticket('Hidden parent', ['project_id' => $foreign->id()]);
    $this->container->get('current_user')->setAccount($this->actor);
    $this->ticket('Child', ['parent_id' => $hidden->id()]);

    $out = $this->outputs($this->runTool('bakers_ticket_list', ['project' => $this->project->uuid()]));
    self::assertSame(['Child'], array_column($out['tickets'], 'title'));
    self::assertNull($out['tickets'][0]['parent']);
  }

}
