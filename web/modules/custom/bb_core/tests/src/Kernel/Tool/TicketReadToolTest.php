<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\EntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket read through its tool carries its fields and readable comments.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketReadToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Returns the ticket fields and its comments in chronological order.
   */
  public function testReadReturnsFieldsAndComments(): void {
    $ticket = $this->ticket('TR-1', [
      'description' => ['value' => "## Goal\n", 'format' => 'bb_rich'],
      'ticket_type' => $this->term('type', 'feature')->id(),
      'labels' => [$this->term('label', 'retro')->id(), $this->term('label', 'ui')->id()],
      'links' => [['uri' => 'https://example.com/mr/1', 'title' => 'MR']],
    ]);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $comment = static fn (string $type, string $body, int $created) => $storage->create([
      'ticket_id' => $ticket->id(),
      'type' => $type,
      'body' => ['value' => $body, 'format' => 'bb_rich'],
      'created' => $created,
    ]);
    $second = $comment('plan', 'second', 2000);
    $second->save();
    $first = $comment('spec', 'first', 1000);
    $first->save();

    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]));

    self::assertSame($ticket->uuid(), $out['id']);
    self::assertSame($ticket->getIdentifier(), $out['identifier']);
    self::assertSame('TR-1', $out['title']);
    self::assertSame('qualification', $out['state']);
    self::assertSame('bb_work', $out['workflow']);
    self::assertSame("## Goal\n", $out['description']);
    self::assertSame('feature', $out['type']);
    self::assertNull($out['recipe'] ?? NULL);
    self::assertSame(['retro', 'ui'], $out['labels']);
    self::assertSame([['uri' => 'https://example.com/mr/1', 'title' => 'MR']], $out['links']);
    self::assertSame([
      ['id' => $first->uuid(), 'type' => 'spec', 'body' => 'first', 'created' => date('c', 1000), 'author' => 'actor'],
      ['id' => $second->uuid(), 'type' => 'plan', 'body' => 'second', 'created' => date('c', 2000), 'author' => 'actor'],
    ], $out['comments']);
  }

  /**
   * By default returns the 2 newest readable comments and facets over all.
   */
  public function testDefaultReturnsTwoNewestCommentsAndFacets(): void {
    $other = $this->account('other', ['skill_user']);
    $ticket = $this->ticket('TR-6', ['reviewers' => [$other->id()]]);
    $spec = $this->comment($ticket, 'spec', 1000);
    $plan = $this->comment($ticket, 'plan', 2000, ['author' => $other->id()]);
    $test = $this->comment($ticket, 'test', 3000);
    // Another author's draft review is unreadable to the actor.
    $this->container->get('entity_type.manager')->getStorage('bb_comment_type')
      ->create(['id' => 'review', 'label' => 'Review'])
      ->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->comment($ticket, 'secret', 4000, ['bundle' => 'review', 'author' => $other->id()]);

    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]));

    self::assertSame([$plan->uuid(), $test->uuid()], array_column($out['comments'], 'id'));
    self::assertSame([
      'type' => [
        ['value' => 'plan', 'count' => 1, 'newest' => date('c', 2000)],
        ['value' => 'spec', 'count' => 1, 'newest' => date('c', 1000)],
        ['value' => 'test', 'count' => 1, 'newest' => date('c', 3000)],
      ],
      'author' => [
        ['value' => 'actor', 'count' => 2, 'newest' => date('c', 3000)],
        ['value' => 'other', 'count' => 1, 'newest' => date('c', 2000)],
      ],
    ], $out['comment_facets']);

    $read = fn (int $newest): array => array_column($this->outputs($this->runTool('bakers_ticket_read', [
      'ticket' => $ticket->getIdentifier(),
      'newest' => $newest,
    ]))['comments'], 'id');
    self::assertSame([], $read(0));
    self::assertSame([$spec->uuid(), $plan->uuid(), $test->uuid()], $read(10));
  }

  /**
   * A negative `newest` is an input error.
   */
  public function testNegativeNewestFails(): void {
    $this->assertFailure($this->runTool('bakers_ticket_read', [
      'ticket' => $this->ticket('TR-7')->getIdentifier(),
      'newest' => -1,
    ]), 'newest');
  }

  /**
   * The default read of a ticket shaped like a large real one stays small.
   *
   * Body sizes of a real 60-comment ticket (787,122 characters), oldest first.
   */
  public function testDefaultReadOfLargeTicketFits(): void {
    $sizes = [
      7646, 4386, 2610, 7873, 10355, 5981, 1990, 601, 4682, 7605, 1444, 786, 4461, 1158, 872,
      8495, 30409, 22532, 10143, 17657, 19910, 24633, 16178, 17409, 28494, 30388, 53816, 44188,
      47915, 61982, 20669, 15266, 16589, 30208, 34656, 16389, 15513, 7535, 2184, 5859, 2394,
      35490, 7594, 1801, 3199, 1336, 10947, 2565, 1539, 11968, 3359, 302, 1266, 838, 16467,
      3807, 13600, 4511, 2343, 329,
    ];
    $ticket = $this->ticket('TR-8');
    foreach ($sizes as $i => $size) {
      $body = ['value' => str_repeat('x', $size), 'format' => 'bb_rich'];
      $this->comment($ticket, 'summary', 1000 + $i, ['body' => $body]);
    }
    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]));
    self::assertCount(2, $out['comments']);
    self::assertLessThanOrEqual(100000, strlen((string) json_encode($out)));
  }

  /**
   * Saves a published comment by the actor on the ticket.
   *
   * @param \Drupal\Core\Entity\EntityInterface $ticket
   *   The ticket.
   * @param string $type
   *   The comment type, also its body.
   * @param int $created
   *   The creation timestamp.
   * @param array<string, mixed> $values
   *   Field values overriding the defaults.
   *   Field values overriding the defaults.
   */
  private function comment(EntityInterface $ticket, string $type, int $created, array $values = []): EntityInterface {
    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create($values + [
      'ticket_id' => $ticket->id(),
      'type' => $type,
      'body' => ['value' => $type, 'format' => 'bb_rich'],
      'created' => $created,
    ]);
    $comment->save();
    return $comment;
  }

  /**
   * Returns the project, branches, conductor, freeze and metric rows.
   */
  public function testReadReturnsProjectBranchConductorFreezeAndMetrics(): void {
    $conductor = $this->conductor('tr-conductor');
    $ticket = $this->ticket('TR-4', [
      'branch_name' => 'release/2.0',
      'conductor_id' => $conductor->id(),
      'frozen' => TRUE,
      'metrics' => [['name' => 'job_rating.stars', 'value' => '4', 'unit' => NULL]],
    ]);
    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]));
    self::assertSame($this->project->uuid(), $out['project']);
    self::assertSame('release/2.0', $out['branch_name']);
    self::assertSame('main', $out['base_branch']);
    self::assertSame($conductor->uuid(), $out['conductor']);
    self::assertTrue($out['frozen']);
    self::assertSame([['name' => 'job_rating.stars', 'value' => 4.0, 'unit' => NULL]], $out['metrics']);
  }

  /**
   * A guest reads the ticket but not its conductor, which stays undisclosed.
   */
  public function testUnviewableConductorIsNull(): void {
    $ticket = $this->ticket('TR-5', ['conductor_id' => $this->conductor('tr-hidden')->id()]);
    $guest = $this->account('guest', ['skill_user']);
    $this->addMembership($this->workspace, $guest, ['guest']);
    $this->addMembership($this->project->get('teams')->entity, $guest);
    $this->container->get('current_user')->setAccount($guest);
    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]));
    self::assertNull($out['conductor']);
  }

  /**
   * Saves an active conductor of the tool project owned by the actor.
   */
  private function conductor(string $id): EntityInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $id,
      'label' => $id,
      'owner_user_id' => $this->actor->id(),
      'active' => TRUE,
      'status' => 'online',
      'project_id' => $this->project->id(),
    ]);
    $conductor->save();
    return $conductor;
  }

  /**
   * Lists the viewable deployments carrying the ticket with their environments.
   */
  public function testReadReturnsDeployments(): void {
    $this->installEntitySchema('bb_environment');
    user_role_grant_permissions('skill_user', ['view bb_environment']);
    $production = $this->entity('bb_environment', ['name' => 'production', 'project_id' => $this->project->id()]);
    $type = $this->term('type', 'deployment')->id();
    $ticket = $this->ticket('TR-T');
    $unreferenced = $this->ticket('TR-U');
    $first = $this->ticket('TR-D1', [
      'ticket_type' => $type,
      'referenced_tickets' => [$ticket->id()],
      'environments' => [$production->id()],
    ]);
    $second = $this->ticket('TR-D2', ['ticket_type' => $type, 'referenced_tickets' => [$ticket->id()]]);
    // A deployment in a workspace the actor does not belong to stays hidden.
    $foreign = $this->entity('bb_workspace', [
      'name' => 'foreign',
      'slug' => 'foreign',
      'owner_user_id' => $this->account('stranger')->id(),
    ]);
    $group = $this->entity('bb_group', ['name' => 'foreign-group', 'workspace_id' => $foreign->id()]);
    $project = $this->entity('bb_project', ['name' => 'foreign-project', 'group_id' => $group->id()]);
    $this->ticket('TR-D3', [
      'ticket_type' => $type,
      'referenced_tickets' => [$ticket->id()],
      'project_id' => $project->id(),
    ]);

    self::assertSame([
      ['identifier' => $first->getIdentifier(), 'environments' => ['production']],
      ['identifier' => $second->getIdentifier(), 'environments' => []],
    ], $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]))['deployments']);
    self::assertSame([], $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $unreferenced->getIdentifier()]))['deployments']);
  }

  /**
   * An unknown or unreadable ticket is an input error naming it.
   */
  public function testUnreadableTicketFails(): void {
    $id = $this->ticket('TR-2')->getIdentifier();
    $this->assertFailure($this->runTool('bakers_ticket_read', ['ticket' => 'TR-404']), 'TR-404');
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    $this->assertFailure($this->runTool('bakers_ticket_read', ['ticket' => $id]), $id);
  }

}
