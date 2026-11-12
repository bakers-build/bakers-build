<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Making an account the assignee of a ticket is an activity of its own.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class AssignedActivityTest extends KernelTestBase {

  use OgScopeFixtureTrait;
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
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_activity', 'bb_notification_setting',
      'bb_comment', 'bb_run', 'bb_term',
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
    $project = $storage('bb_project')->create(['name' => 'p', 'key' => 'ASG', 'group_id' => $group->id()]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->projectId = (int) $project->id();
    foreach (['owner', 'first', 'second', 'reviewer', 'reader'] as $name) {
      $account = $this->createUser(['access user profiles'], $name);
      self::assertInstanceOf(UserInterface::class, $account);
      $this->addMembership($workspace, $account, ['contributor']);
      $this->seatOnProjectTeam($project, $account);
      $this->people[$name] = $account;
    }
  }

  /**
   * A ticket created with an assignee records created and assigned.
   */
  public function testCreatingWithAnAssigneeRecordsOneAssignedRow(): void {
    $this->setCurrentUser($this->people['owner']);
    $ticket = $this->ticket('first');
    self::assertCount(1, $this->rows($ticket, 'created'));
    $rows = $this->rows($ticket, 'assigned');
    self::assertCount(1, $rows);
    self::assertSame($this->uids('first'), $this->accounts($rows[0]));
    self::assertSame((int) $this->people['owner']->id(), (int) $rows[0]->get('actor')->target_id);
  }

  /**
   * A ticket created without an assignee records no assigned row.
   */
  public function testCreatingWithoutAnAssigneeRecordsNothing(): void {
    $ticket = $this->ticket(NULL);
    self::assertSame([], $this->rows($ticket, 'assigned'));
  }

  /**
   * Handing the ticket to someone else records a row for the new assignee.
   */
  public function testChangingTheAssigneeRecordsOneRowForTheNewOne(): void {
    $ticket = $this->ticket('first');
    $ticket->set('assignee_user_id', $this->people['second']->id())->save();
    $rows = $this->rows($ticket, 'assigned');
    self::assertCount(2, $rows);
    self::assertSame($this->uids('second'), $this->accounts($rows[1]));
  }

  /**
   * Saving the same assignee again is silent; a later hand back is not.
   */
  public function testTheSameAssigneeAgainIsSilentButHandingBackIsNot(): void {
    $ticket = $this->ticket('first');
    $ticket->set('assignee_user_id', $this->people['first']->id())->save();
    $ticket->set('title', 'renamed')->save();
    self::assertCount(1, $this->rows($ticket, 'assigned'));

    $ticket->set('assignee_user_id', $this->people['second']->id())->save();
    $ticket->set('assignee_user_id', $this->people['first']->id())->save();
    $rows = $this->rows($ticket, 'assigned');
    self::assertCount(3, $rows);
    self::assertSame($this->uids('first'), $this->accounts($rows[2]));
  }

  /**
   * Clearing the assignee records nothing.
   */
  public function testClearingTheAssigneeRecordsNothing(): void {
    $ticket = $this->ticket('first');
    $ticket->set('assignee_user_id', NULL)->save();
    self::assertCount(1, $this->rows($ticket, 'assigned'));
  }

  /**
   * Account zero is nobody: it is never addressed.
   */
  public function testAccountZeroIsNeverAddressed(): void {
    $ticket = $this->ticket('first');
    $ticket->set('assignee_user_id', 0)->save();
    self::assertCount(1, $this->rows($ticket, 'assigned'));
  }

  /**
   * One save that changes assignee, reviewers and state records three rows.
   */
  public function testAssigneeReviewersAndStateInOneSaveRecordThreeRows(): void {
    $ticket = $this->ticket('first');
    $ticket->set('assignee_user_id', $this->people['second']->id())
      ->set('reviewers', [$this->people['reviewer']->id()])
      ->set('state', 'review')
      ->save();
    self::assertCount(1, $this->rows($ticket, 'status_changed'));
    self::assertCount(1, $this->rows($ticket, 'review_requested'));
    self::assertCount(2, $this->rows($ticket, 'assigned'));
  }

  /**
   * An assignee derived from the conductor's owner is recorded once.
   */
  public function testAssigneeDerivedFromTheConductorIsRecordedOnce(): void {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => 'node-asg',
      'label' => 'node-asg',
      'owner_user_id' => $this->people['second']->id(),
      'status' => 'online',
      'project_id' => $this->projectId,
      'states' => ['working'],
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $conductor->save();
    $ticket = $this->ticket(NULL);
    self::assertSame([], $this->rows($ticket, 'assigned'));

    $ticket->set('conductor_id', $conductor->id())->save();
    $rows = $this->rows($ticket, 'assigned');
    self::assertCount(1, $rows);
    self::assertSame($this->uids('second'), $this->accounts($rows[0]));

    $ticket->set('title', 'renamed')->save();
    $ticket->set('conductor_id', NULL)->save();
    self::assertCount(1, $this->rows($ticket, 'assigned'), 'Later saves and a conductor switch add nothing.');
  }

  /**
   * The feed names the assignee to a reader who may view the account.
   */
  public function testTheFeedNamesTheAssignee(): void {
    $ticket = $this->ticket('first');
    $this->setCurrentUser($this->people['reader']);
    $line = $this->line($this->rows($ticket, 'assigned')[0]);
    self::assertSame('assigned', $line['tag']);
    self::assertSame('assigned to first', $line['statement']);
    self::assertSame('human', $line['role']);
  }

  /**
   * The state read for a stale loaded ticket is the database's, not a cache's.
   */
  public function testStaleLoadedTicketDoesNotRepeatAssignment(): void {
    $ticket = $this->ticket(NULL);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $stale = $storage->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $stale);
    $ticket->set('assignee_user_id', $this->people['first']->id())->save();
    $stale->set('assignee_user_id', $this->people['first']->id())->save();
    self::assertCount(1, $this->rows($ticket, 'assigned'));
  }

  /**
   * A rolled-back assignment is not remembered as the predecessor.
   *
   * A rollback does not undo the persistent entity cache, so a predecessor
   * read through it would be the rolled-back ticket.
   */
  public function testRolledBackAssignmentIsNotTheNextPredecessor(): void {
    $ticket = $this->ticket(NULL);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $transaction = $this->container->get('database')->startTransaction();
    $ticket->set('assignee_user_id', $this->people['first']->id())->save();
    // Loading after the save fills the persistent entity cache.
    $storage->resetCache([$ticket->id()]);
    $storage->load($ticket->id());
    $transaction->rollBack();
    unset($transaction);
    self::assertSame([], $this->rows($ticket, 'assigned'));

    // The cache still serves the rolled-back ticket; the database says none.
    $again = $storage->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $again);
    $again->set('assignee_user_id', $this->people['first']->id())->save();

    self::assertCount(1, $this->rows($ticket, 'assigned'));
  }

  /**
   * A ticket owned by owner, assigned to a named person or to nobody.
   */
  private function ticket(?string $assignee): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'assigned-activity',
      'workflow' => 'bb_work',
      'state' => 'working',
      'project_id' => $this->projectId,
      'owner_user_id' => $this->people['owner']->id(),
      'assignee_user_id' => $assignee === NULL ? NULL : $this->people[$assignee]->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The ticket's rows of one kind, oldest first.
   *
   * @return list<\Drupal\bb_activity\Entity\BbActivity>
   *   The rows.
   */
  private function rows(BbTicketInterface $ticket, string $kind): array {
    $storage = $this->activities();
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('kind', $kind)
      ->sort('id')
      ->execute();
    $storage->resetCache();
    return array_values(array_filter($storage->loadMultiple($ids), static fn ($row): bool => $row instanceof BbActivity));
  }

  /**
   * The activity storage.
   */
  private function activities(): EntityStorageInterface {
    return $this->container->get('entity_type.manager')->getStorage('bb_activity');
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
