<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Computed pending_reviews lists submitted reviews awaiting a decision.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class PendingReviewsFieldTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use ReviewStateTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser();
  }

  /**
   * Drafts, accepted, rejected and legacy comments stay out of the queue.
   */
  public function testPendingReviewsAreSubmittedOnly(): void {
    $reviewer = $this->createUser(['view bb_ticket', 'view bb_comment']);
    self::assertInstanceOf(UserInterface::class, $reviewer);
    $assignee = $this->createUser(['view bb_ticket', 'view bb_comment']);
    self::assertInstanceOf(UserInterface::class, $assignee);
    $ticket = $this->createTicket($assignee, $reviewer);
    $this->setCurrentUser($reviewer);

    $draft = $this->createReview($ticket, $reviewer, 'draft body');
    $submitted = $this->createReview($ticket, $reviewer, 'please accept');
    $this->applyReviewTransition($submitted, 'submit');
    $submitted->save();

    $this->setCurrentUser($assignee);
    $accepted = $this->createReview($ticket, $reviewer, 'shipped');
    $this->setCurrentUser($reviewer);
    $this->applyReviewTransition($accepted, 'submit');
    $accepted->save();
    $this->setCurrentUser($assignee);
    $this->applyReviewTransition($accepted, 'accept');
    $accepted->save();

    $legacy = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'ticket_id' => $ticket->id(),
        'author' => $assignee->id(),
        'body' => ['value' => 'handoff', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $legacy);
    $legacy->save();

    $ids = $this->pendingIds($ticket);
    self::assertSame([(string) $submitted->id()], $ids);
    self::assertNotContains((string) $draft->id(), $ids);
    self::assertNotContains((string) $accepted->id(), $ids);
    self::assertNotContains((string) $legacy->id(), $ids);

    $this->setCurrentUser($reviewer);
    self::assertSame([], $this->pendingIds($ticket), 'Authors do not see the assignee queue.');
  }

  /**
   * A reader never receives pending review ids.
   */
  public function testReaderSeesEmptyPendingQueue(): void {
    $reviewer = $this->createUser(['view bb_ticket', 'view bb_comment']);
    self::assertInstanceOf(UserInterface::class, $reviewer);
    $assignee = $this->createUser(['view bb_ticket', 'view bb_comment']);
    self::assertInstanceOf(UserInterface::class, $assignee);
    $reader = $this->createUser(['view bb_ticket', 'view bb_comment']);
    self::assertInstanceOf(UserInterface::class, $reader);
    $ticket = $this->createTicket($assignee, $reviewer);
    $this->setCurrentUser($reviewer);
    $submitted = $this->createReview($ticket, $reviewer, 'please accept');
    $this->applyReviewTransition($submitted, 'submit');
    $submitted->save();
    $this->setCurrentUser($reader);
    self::assertSame([], $this->pendingIds($ticket));
  }

  /**
   * Creates a ticket with assignee and reviewer.
   */
  private function createTicket(UserInterface $assignee, UserInterface $reviewer): BbTicketInterface {
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'ws', 'slug' => 'ws-pending']);
    $workspace->save();
    $group = $etm->getStorage('bb_group')->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $etm->getStorage('bb_team')->create(['name' => 't', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'p',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $project->save();
    foreach ([$assignee, $reviewer] as $account) {
      $this->addMembership($workspace, $account, ['contributor']);
      $this->addMembership($team, $account, ['member']);
    }
    $ticket = $etm->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'T',
      'state' => 'todo',
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee->id(),
      'reviewers' => [$reviewer->id()],
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates a saved review draft.
   */
  private function createReview(BbTicketInterface $ticket, UserInterface $author, string $body): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'bundle' => 'review',
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => $body, 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $comment;
  }

  /**
   * Pending review ids on a freshly loaded ticket.
   *
   * @return list<string>
   *   Target ids in list order.
   */
  private function pendingIds(BbTicketInterface $ticket): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([(string) $ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    $ids = [];
    foreach ($reloaded->get('pending_reviews') as $item) {
      $ids[] = (string) ($item->getValue()['target_id'] ?? '');
    }
    return $ids;
  }

}
