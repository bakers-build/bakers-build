<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
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
    $this->container->get('router.builder')->rebuild();
    $frozenAt = 1767225600;
    $parent = $this->ticket('PAR-1', [
      'labels' => [$this->term('label', 'pingpong')->id(), $this->term('label', 'question')->id()],
      'links' => [['uri' => 'https://example.slack.com/archives/C1/p1', 'title' => 'Thread']],
      'origin' => 'https://issues.test/1',
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
      [
        'id', 'identifier', 'title', 'url', 'origin', 'state', 'links',
        'labels', 'frozen', 'frozen_at', 'parent', 'closed', 'ticket_type',
        'changed', 'active_run',
      ],
      array_keys($rows[0]),
    );
    self::assertSame($parent->getIdentifier(), $rows[0]['identifier']);
    self::assertSame('PAR-1', $rows[0]['title']);
    self::assertSame($parent->toUrl()->setAbsolute()->toString(), $rows[0]['url']);
    self::assertSame('https://issues.test/1', $rows[0]['origin']);
    self::assertNull($rows[1]['origin']);
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

  /**
   * A list client filters open tickets, sorts by change and sees active runs.
   */
  public function testOpenTicketsNewestChangeFirstWithTheirActiveRun(): void {
    user_role_grant_permissions('skill_user', ['view bb_run']);
    $bug = $this->term('type', 'bug');
    $older = $this->ticket('OLD-1', ['ticket_type' => $bug->id()]);
    $newer = $this->ticket('NEW-1');
    $closed = $this->ticket('DONE-1');
    $closed->markClosed(1767225600)->save();
    $this->seedRun($older, 'done');
    $running = $this->seedRun($older, 'running');
    $this->seedRun($newer, 'failed');
    $claimed = $this->seedRun($newer, 'claimed');
    // After the runs: a run write touches its ticket.
    $this->changedAt($older, 1767225600);
    $this->changedAt($newer, 1767312000);

    $rows = $this->outputs($this->runTool('bakers_ticket_list', [
      'project' => $this->project->uuid(),
      'closed' => FALSE,
      'sort' => '-changed',
    ]))['tickets'];

    self::assertSame([$newer->uuid(), $older->uuid()], array_column($rows, 'id'));
    self::assertSame([NULL, 'bug'], array_column($rows, 'ticket_type'));
    self::assertSame(1767312000, (new \DateTimeImmutable($rows[0]['changed']))->getTimestamp());
    self::assertSame(['id' => $claimed->uuid(), 'state' => 'claimed'], $rows[0]['active_run'], 'A claimed run is active, a failed one not.');
    self::assertSame(['id' => $running->uuid(), 'state' => 'running'], $rows[1]['active_run']);

    $closedOnly = $this->outputs($this->runTool('bakers_ticket_list', [
      'project' => $this->project->uuid(),
      'closed' => TRUE,
    ]));
    self::assertSame([$closed->uuid()], array_column($closedOnly['tickets'], 'id'));
    self::assertNull($closedOnly['tickets'][0]['active_run']);
    // Without the new inputs, every ticket in id order, as before.
    $all = $this->outputs($this->runTool('bakers_ticket_list', ['project' => $this->project->uuid()]));
    self::assertSame([$older->uuid(), $newer->uuid(), $closed->uuid()], array_column($all['tickets'], 'id'));

    $this->assertFailure(
      $this->runTool('bakers_ticket_list', ['project' => $this->project->uuid(), 'sort' => 'title']),
      'sort must be id or -changed.',
    );
  }

  /**
   * Stores a ticket's last change time.
   */
  private function changedAt(BbTicketInterface $ticket, int $time): void {
    $this->container->get('database')->update('bb_ticket')
      ->fields(['changed' => $time])->condition('id', $ticket->id())->execute();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->resetCache();
  }

  /**
   * Creates a run of the ticket in the given state on a new conductor.
   */
  private function seedRun(BbTicketInterface $ticket, string $state): ContentEntityInterface {
    $name = 'node-' . $this->randomMachineName();
    $conductor = $this->entity('bb_conductor', [
      'conductor_id' => $name,
      'label' => $name,
      'owner_user_id' => $this->actor->id(),
      'project_id' => $this->project->id(),
    ]);
    return $this->entity('bb_run', [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $this->actor->id(),
      'state' => $state,
      'claim_expires_at' => 4102444800,
    ]);
  }

}
