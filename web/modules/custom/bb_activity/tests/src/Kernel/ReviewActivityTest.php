<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\bb_core\Kernel\ReviewStateTrait;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Requested and completed reviews are activities of their own.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ReviewActivityTest extends KernelTestBase {

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
    'field', 'og', 'link', 'text', 'filter', 'island',
    'ui_patterns',
    'bb_core', 'bb_activity',
  ];

  /**
   * The project the tickets belong to.
   */
  private int $projectId;

  /**
   * Workspace contributors keyed by role.
   *
   * @var array<string, \Drupal\user\UserInterface>
   */
  private array $people = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_activity', 'bb_notification_setting', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    // Uid 1 bypasses access checks, so it is never one of the people below.
    $this->createUser([], 'root');
    $this->container->get('router.builder')->rebuild();
    $storage = fn (string $type) => $this->container->get('entity_type.manager')->getStorage($type);
    $workspace = $storage('bb_workspace')->create(['name' => 'ws', 'slug' => 'ws']);
    $workspace->save();
    $group = $storage('bb_group')->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $storage('bb_project')->create(['name' => 'p', 'key' => 'REV', 'group_id' => $group->id()]);
    $project->save();
    $this->projectId = (int) $project->id();
    foreach (['owner', 'assignee', 'reviewer', 'second', 'reader'] as $name) {
      $account = $this->createUser(['access user profiles'], $name);
      self::assertInstanceOf(UserInterface::class, $account);
      $this->addMembership($workspace, $account, ['contributor']);
      $this->people[$name] = $account;
    }
  }

  /**
   * Accounts added in one save make one row that lists them.
   */
  public function testAddingReviewersRecordsOneRowListingThem(): void {
    $ticket = $this->ticket();
    $this->setCurrentUser($this->people['owner']);
    $ticket->set('reviewers', [$this->people['reviewer']->id(), $this->people['second']->id()])->save();
    $rows = $this->rows($ticket, 'review_requested');
    self::assertCount(1, $rows);
    self::assertSame($this->uids('reviewer', 'second'), $this->accounts($rows[0]));
    self::assertSame((int) $this->people['owner']->id(), (int) $rows[0]->get('actor')->target_id);
  }

  /**
   * Only newly added reviewers are recorded; a removal records nothing.
   */
  public function testOnlyAddedReviewersAreRecordedAndRemovalsAreSilent(): void {
    $ticket = $this->ticket();
    $ticket->set('reviewers', [$this->people['reviewer']->id()])->save();
    $ticket->set('reviewers', [$this->people['reviewer']->id(), $this->people['second']->id()])->save();
    $ticket->set('reviewers', [])->save();
    $ticket->set('title', 'renamed')->save();
    $rows = $this->rows($ticket, 'review_requested');
    self::assertCount(2, $rows);
    self::assertSame($this->uids('reviewer'), $this->accounts($rows[0]));
    self::assertSame($this->uids('second'), $this->accounts($rows[1]));
  }

  /**
   * A save that adds a reviewer and changes the state records both rows.
   */
  public function testAddingReviewersWhileChangingStateRecordsBothRows(): void {
    $ticket = $this->ticket();
    $ticket->set('reviewers', [$this->people['reviewer']->id()])->set('state', 'review')->save();
    self::assertCount(1, $this->rows($ticket, 'status_changed'));
    self::assertCount(1, $this->rows($ticket, 'review_requested'));
  }

  /**
   * Reviewers named when the ticket is created are a request too.
   */
  public function testReviewersNamedOnCreateAreRequested(): void {
    $ticket = $this->ticket([$this->people['reviewer']->id()]);
    self::assertCount(1, $this->rows($ticket, 'created'));
    $rows = $this->rows($ticket, 'review_requested');
    self::assertCount(1, $rows);
    self::assertSame($this->uids('reviewer'), $this->accounts($rows[0]));
  }

  /**
   * A submitted review is addressed to whoever asked for it.
   */
  public function testSubmittedReviewIsAddressedToTheRequester(): void {
    $ticket = $this->ticket();
    $this->setCurrentUser($this->people['owner']);
    $ticket->set('reviewers', [$this->people['reviewer']->id()])->save();
    $this->setCurrentUser($this->people['reviewer']);
    $review = $this->draft($ticket);
    self::assertSame([], $this->rows($ticket, 'review_completed'), 'A draft is not a completed review.');
    $this->applyReviewTransition($review, 'submit');
    $review->save();

    $rows = $this->rows($ticket, 'review_completed');
    self::assertCount(1, $rows);
    self::assertSame((string) $review->id(), (string) $rows[0]->get('comment_id')->target_id);
    self::assertSame($this->uids('owner'), $this->accounts($rows[0]));
    self::assertSame((int) $this->people['reviewer']->id(), (int) $rows[0]->get('actor')->target_id);
  }

  /**
   * Without a request anybody made, the assignee is the one to tell.
   */
  public function testWithoutRequesterTheAssigneeIsAddressed(): void {
    // The anonymous system context names the reviewer.
    $ticket = $this->ticket([$this->people['reviewer']->id()]);
    $this->setCurrentUser($this->people['reviewer']);
    $review = $this->draft($ticket);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $rows = $this->rows($ticket, 'review_completed');
    self::assertSame($this->uids('assignee'), $this->accounts($rows[0]));
  }

  /**
   * The feed names the requested reviewers and links the submitted review.
   */
  public function testTheFeedNamesReviewersAndLinksTheReview(): void {
    $ticket = $this->ticket();
    $this->setCurrentUser($this->people['owner']);
    $ticket->set('reviewers', [$this->people['reviewer']->id(), $this->people['second']->id()])->save();
    $this->setCurrentUser($this->people['reviewer']);
    $review = $this->draft($ticket);
    $this->applyReviewTransition($review, 'submit');
    $review->save();

    $this->setCurrentUser($this->people['assignee']);
    $requested = $this->line($this->rows($ticket, 'review_requested')[0]);
    self::assertSame('review', $requested['tag']);
    self::assertSame('requested a review from reviewer, second', $requested['statement']);
    self::assertSame('human', $requested['role']);
    $completed = $this->line($this->rows($ticket, 'review_completed')[0]);
    self::assertSame('completed a review', $completed['statement']);
    self::assertSame(['Review'], array_column($completed['links'], 'title'));
  }

  /**
   * The addressed accounts are visible only to a reader who may view each.
   */
  public function testTheAccountsFieldFollowsAccountAccess(): void {
    $ticket = $this->ticket([$this->people['reviewer']->id()]);
    $row = $this->rows($ticket, 'review_requested')[0];
    $stranger = $this->createUser([], 'stranger');
    self::assertInstanceOf(UserInterface::class, $stranger);
    self::assertTrue($row->get('accounts')->access('view', $this->people['reader']));
    self::assertFalse($row->get('accounts')->access('view', $stranger));
  }

  /**
   * A ticket owned by owner and assigned to assignee.
   *
   * @param list<int|string|null> $reviewers
   *   Reviewers named on create.
   */
  private function ticket(array $reviewers = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'review-activity',
      'workflow' => 'bb_work',
      'state' => 'working',
      'project_id' => $this->projectId,
      'owner_user_id' => $this->people['owner']->id(),
      'assignee_user_id' => $this->people['assignee']->id(),
      'reviewers' => $reviewers,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * A saved review draft of the current user.
   */
  private function draft(BbTicketInterface $ticket): BbCommentInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $review = $storage->create([
      'bundle' => 'review',
      'ticket_id' => $ticket->id(),
      'author' => $this->container->get('current_user')->id(),
      'body' => ['value' => 'looks good', 'format' => 'plain_text'],
      'type' => 'comment',
    ]);
    self::assertInstanceOf(BbCommentInterface::class, $review);
    $review->save();
    $review = $storage->loadUnchanged($review->id());
    self::assertInstanceOf(BbCommentInterface::class, $review);
    return $review;
  }

  /**
   * The ticket's rows of one kind, oldest first.
   *
   * @return list<\Drupal\bb_activity\Entity\BbActivity>
   *   The rows.
   */
  private function rows(BbTicketInterface $ticket, string $kind): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('kind', $kind)
      ->sort('id')
      ->execute();
    $storage->resetCache();
    return array_values(array_filter($storage->loadMultiple($ids), static fn ($row): bool => $row instanceof BbActivity));
  }

  /**
   * The account IDs a row is addressed to.
   *
   * @return list<int>
   *   Account IDs, in stored order.
   */
  private function accounts(BbActivity $row): array {
    return array_values(array_map(static fn (array $item): int => (int) $item['target_id'], $row->get('accounts')->getValue()));
  }

  /**
   * The IDs of named people.
   *
   * @return list<int>
   *   Account IDs, in argument order.
   */
  private function uids(string ...$names): array {
    return array_values(array_map(fn (string $name): int => (int) $this->people[$name]->id(), $names));
  }

  /**
   * One row rendered as the feed does, for the current user.
   *
   * @return array<string, mixed>
   *   The event component's props.
   */
  private function line(BbActivity $activity): array {
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_activity_event', SourcePluginBase::buildConfiguration('slot', $schema, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $source->setContextValue('entity', $activity);
    $build = $source->getPropValue();
    self::assertIsArray($build);
    return $build['#props'];
  }

}
