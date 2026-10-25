<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the computed `comments` field on bb_ticket.
 *
 * The field reflects every bb_comment whose ticket_id references the
 * ticket, ordered by created ASC, and excludes foreign comments.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCommentsFieldTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket', 'bb_comment'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * The computed field returns own comments in created order, excludes others.
   */
  public function testCommentsFieldReflectsTicketComments(): void {
    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();

    $ticket = $etm->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'T',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    $ticket->save();

    $other = $etm->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'Other',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    $other->save();

    $user = $etm->getStorage('user')->create(['name' => 'author']);
    $user->save();

    $store = $etm->getStorage('bb_comment');
    $second = $store->create([
      'ticket_id' => $ticket->id(),
      'author' => $user->id(),
      'body' => ['value' => 'second', 'format' => 'bb_rich'],
      'type' => 'spec',
      'created' => 2000,
    ]);
    $second->save();
    $first = $store->create([
      'ticket_id' => $ticket->id(),
      'author' => $user->id(),
      'body' => ['value' => 'first', 'format' => 'bb_rich'],
      'type' => 'comment',
      'created' => 1000,
    ]);
    $first->save();
    $foreign = $store->create([
      'ticket_id' => $other->id(),
      'author' => $user->id(),
      'body' => ['value' => 'foreign', 'format' => 'bb_rich'],
      'type' => 'comment',
      'created' => 1500,
    ]);
    $foreign->save();

    $etm->getStorage('bb_ticket')->resetCache([$ticket->id()]);
    $reloaded = $etm->getStorage('bb_ticket')->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);

    $referenced = $reloaded->get('comments')->referencedEntities();
    $ids = array_map(static fn ($c): int => (int) $c->id(), $referenced);
    $this->assertSame([(int) $first->id(), (int) $second->id()], $ids);
  }

  /**
   * Unpublished reviews are absent from the computed comments list.
   */
  public function testCommentsFieldOmitsUnpublishedReviews(): void {
    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'T',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    $ticket->save();
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $user = $etm->getStorage('user')->create(['name' => 'author']);
    $user->save();
    $ticket->set('reviewers', [$user->id()])->save();
    $store = $etm->getStorage('bb_comment');
    $visible = $store->create([
      'ticket_id' => $ticket->id(),
      'author' => $user->id(),
      'body' => ['value' => 'public', 'format' => 'bb_rich'],
      'type' => 'comment',
    ]);
    $visible->save();
    $draft = $store->create([
      'bundle' => 'review',
      'ticket_id' => $ticket->id(),
      'author' => $user->id(),
      'body' => ['value' => 'private', 'format' => 'bb_rich'],
      'type' => 'comment',
    ]);
    $draft->save();
    $etm->getStorage('bb_ticket')->resetCache([$ticket->id()]);
    $reloaded = $etm->getStorage('bb_ticket')->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    $ids = array_map(
      static fn ($c): int => (int) $c->id(),
      $reloaded->get('comments')->referencedEntities(),
    );
    $this->assertSame([(int) $visible->id()], $ids);
  }

  /**
   * A ticket with no comments yields an empty field.
   */
  public function testCommentsFieldEmptyWhenNoComments(): void {
    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'T',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();

    $this->assertSame([], $ticket->get('comments')->referencedEntities());
  }

}
