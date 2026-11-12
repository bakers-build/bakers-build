<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\EntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The comment read returns a ticket's readable comments matching its filters.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CommentReadToolTest extends BakersToolTestBase {

  /**
   * The ticket under test.
   */
  private BbTicketInterface $ticket;

  /**
   * Its readable comments by key, oldest first.
   *
   * @var array<string, \Drupal\Core\Entity\EntityInterface>
   */
  private array $comments = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $other = $this->account('other', ['skill_user']);
    $this->ticket = $this->ticket('CR-1', ['reviewers' => [$other->id()]]);
    foreach ([
      'qualification' => ['qualification', NULL],
      'summary1' => ['summary', NULL],
      'acceptance' => ['acceptance', NULL],
      'coding' => ['coding', $other],
      'summary2' => ['summary', $other],
      'review' => ['review', NULL],
      'summary3' => ['summary', NULL],
    ] as $key => [$type, $author]) {
      $this->comments[$key] = $this->comment($type, 1000 + count($this->comments), $author ? ['author' => $author->id()] : []);
    }
    // Another author's draft review is unreadable to the actor.
    $this->container->get('entity_type.manager')->getStorage('bb_comment_type')
      ->create(['id' => 'review', 'label' => 'Review'])
      ->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->comment('summary', 9000, ['bundle' => 'review', 'author' => $other->id()]);
  }

  /**
   * Without a filter, returns every readable comment, oldest first.
   */
  public function testNoFilterReturnsAllReadable(): void {
    self::assertSame(array_keys($this->comments), $this->read([]));
  }

  /**
   * Types, the newest per type, authors and ids filter and combine with AND.
   */
  public function testFilters(): void {
    self::assertSame(['acceptance', 'coding'], $this->read(['type' => ['acceptance', 'coding']]));
    self::assertSame(['summary3'], $this->read(['type' => ['summary'], 'newest' => 1]));
    self::assertSame(['qualification', 'acceptance', 'summary3'], $this->read([
      'type' => ['qualification', 'acceptance', 'summary'],
      'newest' => 1,
    ]));
    self::assertSame(['review', 'summary3'], $this->read(['newest' => 2]));
    self::assertSame(['coding', 'summary2'], $this->read(['author' => ['other']]));
    self::assertSame(['summary2'], $this->read(['author' => ['other'], 'type' => ['summary']]));
    self::assertSame(['summary1', 'review'], $this->read([
      'ids' => [$this->comments['review']->uuid(), $this->comments['summary1']->uuid()],
    ]));
  }

  /**
   * Returns the comment fields the ticket read returns.
   */
  public function testItemShape(): void {
    $out = $this->outputs($this->runTool('bakers_comment_read', [
      'ticket' => $this->ticket->getIdentifier(),
      'ids' => [$this->comments['coding']->uuid()],
    ]));
    self::assertSame([
      [
        'id' => $this->comments['coding']->uuid(),
        'type' => 'coding',
        'body' => 'coding',
        'created' => date('c', 1003),
        'author' => 'other',
      ],
    ], $out['comments']);
  }

  /**
   * An unreadable ticket and a `newest` below 1 are input errors.
   */
  public function testInputErrors(): void {
    $this->assertFailure($this->runTool('bakers_comment_read', ['ticket' => 'CR-404']), 'CR-404');
    $this->assertFailure($this->runTool('bakers_comment_read', [
      'ticket' => $this->ticket->getIdentifier(),
      'newest' => 0,
    ]), 'newest');
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    $this->assertFailure($this->runTool('bakers_comment_read', ['ticket' => $this->ticket->getIdentifier()]), $this->ticket->getIdentifier());
  }

  /**
   * The keys of the comments a read with these filters returns.
   *
   * @param array<string, mixed> $filters
   *   The tool inputs besides the ticket.
   *
   * @return list<string>
   *   Comment keys, in the returned order.
   */
  private function read(array $filters): array {
    $keys = array_flip(array_map(static fn (EntityInterface $comment): string => (string) $comment->uuid(), $this->comments));
    $out = $this->outputs($this->runTool('bakers_comment_read', ['ticket' => $this->ticket->getIdentifier()] + $filters));
    return array_values(array_map(static fn (array $comment): string => $keys[$comment['id']] ?? $comment['id'], $out['comments']));
  }

  /**
   * Saves a published comment by the actor on the ticket.
   *
   * @param string $type
   *   The comment type, also its body.
   * @param int $created
   *   The creation timestamp.
   * @param array<string, mixed> $values
   *   Field values overriding the defaults.
   */
  private function comment(string $type, int $created, array $values = []): EntityInterface {
    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create($values + [
      'ticket_id' => $this->ticket->id(),
      'type' => $type,
      'body' => ['value' => $type, 'format' => 'bb_rich'],
      'created' => $created,
    ]);
    $comment->save();
    return $comment;
  }

}
