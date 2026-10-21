<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the computed `handoff_comments` and `summary_comment` fields.
 *
 * `comments` reflects every comment on the ticket; the ticket detail body needs
 * that list split in two (BB-414 D3): the handoff stream is everything that
 * is NOT a `summary`, oldest first, and the status band shows the single
 * newest `summary`.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class HandoffCommentsFieldTest extends KernelTestBase {

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
    // bb_run is installed because BbTicket::preSave() queries runs; without
    // its schema every save here dies with a missing-table SQL error.
    $types = [
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket',
      'bb_comment', 'bb_run',
    ];
    foreach ($types as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * The handoff stream is every non-summary comment, oldest first.
   */
  public function testHandoffCommentsExcludeSummariesOldestFirst(): void {
    $ticket = $this->createTicket();
    $other = $this->createTicket();

    $spec = $this->createComment($ticket, 'spec', 2000);
    $summary = $this->createComment($ticket, 'summary', 2500);
    $plan = $this->createComment($ticket, 'plan', 1000);
    $foreign = $this->createComment($other, 'comment', 1500);

    $reloaded = $this->reload($ticket);
    $ids = $this->referencedIds($reloaded, 'handoff_comments');
    $this->assertSame([(int) $plan->id(), (int) $spec->id()], $ids);
    $this->assertNotContains((int) $summary->id(), $ids);
    $this->assertNotContains((int) $foreign->id(), $ids);
  }

  /**
   * The summary field carries exactly the newest summary comment.
   */
  public function testSummaryCommentIsTheNewestSummary(): void {
    $ticket = $this->createTicket();
    $other = $this->createTicket();

    $this->createComment($ticket, 'spec', 3000);
    $this->createComment($ticket, 'summary', 1000);
    $newest = $this->createComment($ticket, 'summary', 2000);
    $this->createComment($other, 'summary', 9000);

    $reloaded = $this->reload($ticket);
    $ids = $this->referencedIds($reloaded, 'summary_comment');
    $this->assertSame([(int) $newest->id()], $ids);
  }

  /**
   * A ticket with no comments at all yields two empty fields.
   */
  public function testBothFieldsEmptyWhenNoComments(): void {
    $ticket = $this->createTicket();
    $reloaded = $this->reload($ticket);

    $this->assertSame([], $this->referencedIds($reloaded, 'handoff_comments'));
    $this->assertSame([], $this->referencedIds($reloaded, 'summary_comment'));
  }

  /**
   * Comments but no summary: the stream fills, the summary stays empty.
   */
  public function testSummaryCommentEmptyWhenNoSummaryExists(): void {
    $ticket = $this->createTicket();
    $comment = $this->createComment($ticket, 'comment', 1000);

    $reloaded = $this->reload($ticket);
    $this->assertSame(
      [(int) $comment->id()],
      $this->referencedIds($reloaded, 'handoff_comments'),
    );
    $this->assertSame([], $this->referencedIds($reloaded, 'summary_comment'));
  }

  /**
   * Creates a saved ticket in its own project.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket.
   */
  private function createTicket(): BbTicketInterface {
    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')->create([
      'workflow' => 'bb_feature',
      'title' => 'T',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates a saved comment on a ticket.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket the comment belongs to.
   * @param string $type
   *   The comment type (the `bb_comment_type` attribute over JSON:API).
   * @param int $created
   *   The creation timestamp.
   *
   * @return \Drupal\Core\Entity\EntityInterface
   *   The saved comment.
   */
  private function createComment(BbTicketInterface $ticket, string $type, int $created) {
    $etm = $this->container->get('entity_type.manager');
    $user = $etm->getStorage('user')->create(['name' => 'a' . uniqid()]);
    $user->save();
    $comment = $etm->getStorage('bb_comment')->create([
      'ticket_id' => $ticket->id(),
      'author' => $user->id(),
      'body' => ['value' => $type, 'format' => 'bb_rich'],
      'type' => $type,
      'created' => $created,
    ]);
    $comment->save();
    return $comment;
  }

  /**
   * Reloads a ticket from storage, bypassing the static cache.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to reload.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The freshly loaded ticket.
   */
  private function reload(BbTicketInterface $ticket): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket');
    $storage->resetCache([$ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Returns the referenced entity ids of a computed field, in order.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to read.
   * @param string $field
   *   The field name.
   *
   * @return array<int>
   *   The referenced entity ids.
   */
  private function referencedIds(BbTicketInterface $ticket, string $field): array {
    $referenced = $ticket->get($field)->referencedEntities();
    return array_map(static fn ($entity): int => (int) $entity->id(), $referenced);
  }

}
