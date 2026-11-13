<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Updating a ticket through its tool changes only the given fields.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketUpdateToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_environment');
    user_role_grant_permissions('skill_user', ['view bb_environment']);
  }

  /**
   * Reviewer operations preserve unrelated accounts and collapse duplicates.
   */
  public function testReviewerOperations(): void {
    $keep = $this->account('keep');
    $add = $this->account('add');
    foreach ([$keep, $add] as $account) {
      $account->set('mail', $account->getAccountName() . '@example.test')->save();
      $this->addMembership($this->workspace, $account, ['contributor']);
    }
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $ticket = $this->ticket('TU-reviewers', ['reviewers' => [$keep->id()]]);
    $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'reviewers_add' => ['Add@Example.TEST', 'add@example.test', 'keep@example.test'],
    ]));
    self::assertSame([$keep->id(), $add->id()], array_column($this->reload($ticket)->get('reviewers')->getValue(), 'target_id'));
    $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'reviewers_remove' => ['keep@example.test'],
    ]));
    $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'reviewers_remove' => ['keep@example.test'],
    ]));
    self::assertSame([$add->id()], array_column($this->reload($ticket)->get('reviewers')->getValue(), 'target_id'));
    $read = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->uuid()]));
    self::assertSame([['name' => 'add', 'mail' => NULL]], $read['reviewers']);
    $update = $this->outputs($this->runTool('bakers_ticket_update', ['ticket' => $ticket->uuid(), 'reviewers_add' => []]));
    self::assertSame($read['reviewers'], $update['reviewers']);
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'reviewers_add' => ['ADD@example.test'],
      'reviewers_remove' => ['add@example.test'],
    ]), 'both added and removed');
  }

  /**
   * Ineligible reviewers refuse the entire update without disclosing accounts.
   */
  public function testInvalidReviewersRollBack(): void {
    $foreign = $this->account('foreign');
    $foreign->set('mail', 'foreign@example.test')->save();
    [$workspace] = $this->foreignWorkspace();
    $this->addMembership($workspace, $foreign, ['contributor']);
    $this->container->get('current_user')->setAccount($this->actor);
    $blocked = $this->account('blocked');
    $blocked->set('mail', 'blocked@example.test')->block()->save();
    $this->addMembership($this->workspace, $blocked, ['contributor']);
    $ticket = $this->ticket('TU-refused');
    foreach (['missing@example.test', 'foreign@example.test', 'blocked@example.test'] as $email) {
      foreach (['reviewers_add', 'reviewers_remove'] as $input) {
        $this->assertFailure($this->runTool('bakers_ticket_update', [
          'ticket' => $ticket->uuid(),
          'title' => 'Not saved',
          'labels_add' => ['rolled-back'],
          $input => [$email],
        ]), 'No account with this e-mail address can be a reviewer in this workspace.');
        self::assertSame('TU-refused', $this->reload($ticket)->label());
        self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_term')->loadByProperties(['name' => 'rolled-back']));
      }
    }
  }

  /**
   * Links upsert in place with distinct omitted and empty title semantics.
   */
  public function testLinkOperations(): void {
    $ticket = $this->ticket('TU-links', [
      'links' => [
      ['uri' => 'https://example.test/keep', 'title' => 'Keep'],
      ['uri' => 'https://example.test/edit', 'title' => 'Old'],
      ],
    ]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'links_add' => [
        ['uri' => 'https://example.test/edit', 'title' => 'New'],
        ['uri' => 'https://example.test/added', 'title' => 'Added'],
        ['uri' => 'https://example.test/added'],
      ],
    ]));
    self::assertSame([
      ['uri' => 'https://example.test/keep', 'title' => 'Keep'],
      ['uri' => 'https://example.test/edit', 'title' => 'New'],
      ['uri' => 'https://example.test/added', 'title' => 'Added'],
    ], $out['links']);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'links_add' => [['uri' => 'https://example.test/edit', 'title' => '']],
      'links_remove' => ['https://example.test/keep', 'https://example.test/absent'],
    ]));
    self::assertSame([
      ['uri' => 'https://example.test/edit', 'title' => ''],
      ['uri' => 'https://example.test/added', 'title' => 'Added'],
    ], $out['links']);
    self::assertSame($out['links'], $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->uuid()]))['links']);
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'links_add' => [['uri' => 'https://example.test/edit']],
      'links_remove' => ['https://example.test/edit'],
    ]), 'both added and removed');
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'title' => 'Not saved',
      'links_add' => [['uri' => 'invalid uri']],
    ]), 'links');
    self::assertSame('TU-links', $this->reload($ticket)->label());
  }

  /**
   * Empty lists keep data; readers and closed tickets cannot edit.
   */
  public function testMetadataAccessAndEmptyLists(): void {
    $ticket = $this->ticket('TU-access', [
      'reviewers' => [$this->actor->id()],
      'links' => [['uri' => 'https://example.test/keep', 'title' => 'Keep']],
    ]);
    $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'reviewers_add' => [],
      'reviewers_remove' => [],
      'links_add' => [],
      'links_remove' => [],
    ]));
    self::assertCount(1, $this->reload($ticket)->get('links'));
    self::assertCount(1, $this->reload($ticket)->get('reviewers'));
    $this->actAsReader();
    foreach (['links_remove' => ['https://example.test/keep'], 'reviewers_add' => ['actor@example.test']] as $input => $value) {
      $this->assertFailure($this->runTool('bakers_ticket_update', ['ticket' => $ticket->uuid(), $input => $value]), 'You may not change');
    }
    $this->container->get('current_user')->setAccount($this->actor);
    $ticket->set('state', 'done')->save();
    foreach (['links_remove' => ['https://example.test/keep'], 'reviewers_add' => ['actor@example.test']] as $input => $value) {
      $this->assertFailure($this->runTool('bakers_ticket_update', ['ticket' => $ticket->uuid(), $input => $value]), 'closed');
    }
  }

  /**
   * Title and description change in one call; nothing else does.
   */
  public function testUpdatesTitleAndDescription(): void {
    $ticket = $this->ticket('TU-1', ['assignee_user_id' => $this->actor->id()]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => 'Clarified title',
      'description' => 'Clarified *ask*.',
    ]));
    self::assertSame([
      'links' => [],
      'reviewers' => [],
      'assignee' => ['name' => 'actor', 'mail' => NULL],
      'identifier' => $ticket->getIdentifier(),
      'title' => 'Clarified title',
      'description' => 'Clarified *ask*.',
      'conductor' => NULL,
      'labels' => [],
      'frozen' => FALSE,
      'environments' => [],
      'referenced_tickets' => [],
    ], $out);
    $stored = $this->reload($ticket);
    self::assertSame('Clarified title', $stored->label());
    self::assertSame('Clarified *ask*.', $stored->get('description')->value);
    self::assertSame((string) $this->actor->id(), (string) $stored->get('assignee_user_id')->target_id);
    self::assertSame($ticket->get('state')->value, $stored->get('state')->value);
    self::assertTrue($stored->get('conductor_id')->isEmpty());
  }

  /**
   * An oversized update keeps the description, title and labels unchanged.
   */
  public function testDescriptionByteBudget(): void {
    $ticket = $this->ticket('TU-budget');
    $body = str_repeat('é', 3072);
    $values = ['ticket' => $ticket->uuid(), 'description' => $body];
    $out = $this->outputs($this->runTool('bakers_ticket_update', $values));
    self::assertSame($body, $out['description']);
    $values['description'] .= 'x';
    $values['title'] = 'Must not change';
    $values['labels_add'] = ['oversized-update'];
    $this->assertFailure($this->runTool('bakers_ticket_update', $values), 'description is 6145 UTF-8 bytes; limit 6144');
    $stored = $this->reload($ticket);
    self::assertSame($body, $stored->get('description')->value);
    self::assertSame('TU-budget', $stored->label());
    self::assertTrue($stored->get('labels')->isEmpty());
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_term')->loadByProperties(['name' => 'oversized-update']));
    $cleared = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->uuid(),
      'description' => '',
    ]));
    self::assertNull($cleared['description']);
  }

  /**
   * A field left out of the call keeps its value.
   */
  public function testAbsentFieldIsKept(): void {
    $ticket = $this->ticket('TU-2', ['description' => ['value' => 'Original ask.', 'format' => 'bb_rich']]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => 'Only the title',
    ]));
    self::assertSame('Original ask.', $out['description']);
    $stored = $this->reload($ticket);
    self::assertSame('Only the title', $stored->label());
    self::assertSame('Original ask.', $stored->get('description')->value);
  }

  /**
   * A call without any changeable field is refused.
   */
  public function testNothingToChangeFails(): void {
    $ticket = $this->ticket('TU-3');
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
    ]), 'Give a title, a description, a conductor, labels to add or remove, frozen, environments to add or referenced tickets to add.');
    self::assertSame('TU-3', $this->reload($ticket)->label());
  }

  /**
   * An account outside the project cannot see the ticket at all.
   */
  public function testOutsiderCannotReadTicket(): void {
    $ticket = $this->ticket('TU-4');
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => 'Hijacked',
    ]), 'does not exist or is not readable');
    self::assertSame('TU-4', $this->reload($ticket)->label());
  }

  /**
   * A reader without update access is refused with the fields named.
   */
  public function testReaderWithoutUpdateAccessFails(): void {
    $ticket = $this->ticket('TU-5');
    $this->actAsReader();
    self::assertSame('TU-5', $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]))['title']);
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => 'Renamed',
      'description' => 'Rewritten.',
    ]), 'You may not change title, description of ticket');
    self::assertSame('TU-5', $this->reload($ticket)->label());
  }

  /**
   * Tickets with work in progress stay editable.
   */
  public function testTicketsInProgressAreUpdated(): void {
    foreach (['working', 'review'] as $state) {
      $ticket = $this->ticket("TU-$state", ['state' => $state]);
      $this->outputs($this->runTool('bakers_ticket_update', [
        'ticket' => $ticket->getIdentifier(),
        'title' => "Updated in $state",
      ]));
      $stored = $this->reload($ticket);
      self::assertSame("Updated in $state", $stored->label());
      self::assertSame($state, $stored->get('state')->value);
    }
  }

  /**
   * A conductor of the ticket's project is assigned.
   */
  public function testAssignsConductorOfTicketProject(): void {
    $conductor = $this->conductor((int) $this->project->id());
    $ticket = $this->ticket('TU-7', ['assignee_user_id' => $this->actor->id()]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'conductor' => $conductor->uuid(),
    ]));
    self::assertSame($conductor->uuid(), $out['conductor']);
    self::assertSame('TU-7', $out['title']);
    self::assertSame((string) $conductor->id(), (string) $this->reload($ticket)->get('conductor_id')->target_id);
  }

  /**
   * A conductor of another project is refused by the project-match rule.
   */
  public function testConductorOfOtherProjectIsRefused(): void {
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => 'other-project',
      'group_id' => $this->project->get('group_id')->target_id,
    ]);
    $other->save();
    $conductor = $this->conductor((int) $other->id());
    $ticket = $this->ticket('TU-8', ['assignee_user_id' => $this->actor->id()]);
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => 'Not saved',
      'conductor' => $conductor->uuid(),
    ]), 'conductor_id: The selected conductor belongs to a different project');
    $stored = $this->reload($ticket);
    self::assertTrue($stored->get('conductor_id')->isEmpty());
    self::assertSame('TU-8', $stored->label());
  }

  /**
   * An unknown conductor UUID is refused before anything is set.
   */
  public function testUnknownConductorIsRefused(): void {
    $ticket = $this->ticket('TU-9');
    $uuid = '00000000-0000-4000-8000-000000000000';
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'conductor' => $uuid,
    ]), "Conductor $uuid does not exist.");
    self::assertTrue($this->reload($ticket)->get('conductor_id')->isEmpty());
  }

  /**
   * Assigning a conductor fills an empty assignee with its owner.
   */
  public function testConductorFillsEmptyAssignee(): void {
    $conductor = $this->conductor((int) $this->project->id());
    $ticket = $this->ticket('TU-10');
    $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'conductor' => $conductor->uuid(),
    ]));
    self::assertSame((string) $this->actor->id(), (string) $this->reload($ticket)->get('assignee_user_id')->target_id);
  }

  /**
   * An empty title is refused with the field's validation message.
   */
  public function testEmptyTitleIsRefused(): void {
    $ticket = $this->ticket('TU-11');
    $result = $this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => '',
      'description' => 'Not saved either.',
    ]);
    $this->assertFailure($result, 'Invalid input: title: ');
    $stored = $this->reload($ticket);
    self::assertSame('TU-11', $stored->label());
    self::assertNull($stored->get('description')->value);
  }

  /**
   * The tool offers no input for state, assignee, terms or approvals.
   */
  public function testInputsAreLimitedToEditableFields(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_ticket_update');
    self::assertSame([
      'ticket', 'title', 'description', 'conductor', 'labels_add', 'labels_remove', 'frozen',
      'environments_add', 'referenced_tickets_add', 'reviewers_add', 'reviewers_remove', 'links_add', 'links_remove',
    ], array_keys($definition->getInputDefinitions()));
  }

  /**
   * Labels are removed by name; every other label stays in its order.
   */
  public function testRemovesNamedLabelsKeepingOthers(): void {
    $labels = array_map(fn ($name) => $this->term('label', $name)->id(), ['keep', 'Question', 'other']);
    $ticket = $this->ticket('TU-15', ['labels' => $labels]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_remove' => ['Question'],
    ]));
    self::assertSame(['keep', 'other'], $out['labels']);
    $names = array_map(static fn ($term) => $term->label(), $this->reload($ticket)->get('labels')->referencedEntities());
    self::assertSame(['keep', 'other'], $names);
  }

  /**
   * Removing a label the ticket lacks changes nothing and creates no term.
   */
  public function testRemoveIgnoresAbsentNames(): void {
    $this->term('label', 'Question');
    $ticket = $this->ticket('TU-16', ['labels' => [$this->term('label', 'keep')->id()]]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_remove' => ['Question', 'never-created'],
    ]));
    self::assertSame(['keep'], $out['labels']);
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_term')->loadByProperties(['name' => 'never-created']));
  }

  /**
   * A name resolves through the lookup labels_add uses, not only its spelling.
   */
  public function testRemoveResolvesNamesLikeAdd(): void {
    $labels = array_map(fn ($name) => $this->term('label', $name)->id(), ['keep', 'Question']);
    $ticket = $this->ticket('TU-19', ['labels' => $labels]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_remove' => ['question'],
    ]));
    self::assertSame(['keep'], $out['labels']);
  }

  /**
   * A reader without update access may not remove labels either.
   */
  public function testReaderCannotRemoveLabels(): void {
    $ticket = $this->ticket('TU-20', ['labels' => [$this->term('label', 'Question')->id()]]);
    $this->actAsReader();
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_remove' => ['Question'],
    ]), 'You may not change labels of ticket');
    self::assertFalse($this->reload($ticket)->get('labels')->isEmpty());
  }

  /**
   * An answer takes the question label off and unfreezes in one call.
   */
  public function testRemoveWithFrozenFalse(): void {
    $ticket = $this->ticket('TU-17', ['labels' => [$this->term('label', 'Question')->id()]]);
    $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'frozen' => TRUE,
    ]));
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_remove' => ['Question'],
      'frozen' => FALSE,
    ]));
    self::assertFalse($out['frozen']);
    self::assertSame([], $out['labels']);
    $stored = $this->reload($ticket);
    self::assertFalse($stored->isFrozen());
    self::assertTrue($stored->get('labels')->isEmpty());
  }

  /**
   * A label named in both lists is refused and the ticket stays as it was.
   */
  public function testSameLabelAddedAndRemovedIsRefused(): void {
    $ticket = $this->ticket('TU-18', ['labels' => [$this->term('label', 'x')->id()]]);
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_add' => ['x'],
      'labels_remove' => ['x'],
    ]), 'Label x is both added and removed.');
    $names = array_map(static fn ($term) => $term->label(), $this->reload($ticket)->get('labels')->referencedEntities());
    self::assertSame(['x'], $names);
  }

  /**
   * Labels are added by name; existing labels stay and duplicates merge.
   */
  public function testAddsLabelsKeepingExistingOnes(): void {
    $keep = $this->term('label', 'keep');
    $this->term('label', 'agent:astra');
    $ticket = $this->ticket('TU-12', ['labels' => [$keep->id()]]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_add' => ['agent:astra', 'keep', 'agent:astra'],
    ]));
    self::assertSame(['keep', 'agent:astra'], $out['labels']);
    $names = array_map(static fn ($term) => $term->label(), $this->reload($ticket)->get('labels')->referencedEntities());
    self::assertSame(['keep', 'agent:astra'], $names);
  }

  /**
   * A name whose key a renamed label holds attaches that label, in any case.
   */
  public function testAddResolvesTakenKeyToExistingLabel(): void {
    $this->term('label', 'Question')->set('name', 'Info')->save();
    foreach (['TU-21' => 'Question', 'TU-22' => 'QUESTION', 'TU-23' => 'question'] as $identifier => $name) {
      $out = $this->outputs($this->runTool('bakers_ticket_update', [
        'ticket' => $this->ticket($identifier)->getIdentifier(),
        'labels_add' => [$name],
      ]));
      self::assertSame(['Info'], $out['labels'], $name);
    }
    $terms = $this->container->get('entity_type.manager')->getStorage('bb_term');
    self::assertCount(1, $terms->loadByProperties(['vid' => 'label', 'key' => 'question']));
  }

  /**
   * A refused update leaves neither the ticket change nor a new label behind.
   */
  public function testRefusedUpdateCreatesNoLabel(): void {
    $ticket = $this->ticket('TU-13');
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => '',
      'labels_add' => ['brand-new'],
    ]), 'Invalid input: title: ');
    self::assertTrue($this->reload($ticket)->get('labels')->isEmpty());
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_term')->loadByProperties(['name' => 'brand-new']));
  }

  /**
   * A workspace guest may not create a label through labels_add.
   */
  public function testGuestCreatesNoLabel(): void {
    $ticket = $this->ticket('TU-14');
    $guest = $this->account('guest', ['skill_user']);
    $this->addMembership($this->workspace, $guest, ['guest']);
    $this->addMembership($this->project->get('teams')->entity, $guest);
    $this->container->get('current_user')->setAccount($guest);
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_add' => ['brand-new'],
    ]), 'may not create it');
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_term')->loadByProperties(['name' => 'brand-new']));
  }

  /**
   * Freezing and unfreezing use the ticket's own freeze bookkeeping.
   */
  public function testFreezesAndUnfreezes(): void {
    $ticket = $this->ticket('TU-14');
    self::assertTrue($this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'frozen' => TRUE,
    ]))['frozen']);
    self::assertTrue($this->reload($ticket)->isFrozen());
    self::assertFalse($this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'frozen' => FALSE,
    ]))['frozen']);
    self::assertFalse($this->reload($ticket)->isFrozen());
  }

  /**
   * A closed ticket is refused with its own message.
   */
  public function testClosedTicketIsRefused(): void {
    $ticket = $this->ticket('TU-6', ['state' => 'done']);
    self::assertTrue($this->reload($ticket)->isClosed());
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'title' => 'Rewritten history',
    ]), sprintf('Ticket %s is closed and can no longer be changed.', $ticket->getIdentifier()));
    self::assertSame('TU-6', $this->reload($ticket)->label());
  }

  /**
   * Referenced tickets are added by identifier or UUID, each one only once.
   */
  public function testAddsReferencedTicketsKeepingExisting(): void {
    $t1 = $this->ticket('TU-R1');
    $t2 = $this->ticket('TU-R2');
    $t3 = $this->ticket('TU-R3');
    $deployment = $this->ticket('TU-D1', ['referenced_tickets' => [$t1->id()]]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $deployment->getIdentifier(),
      'referenced_tickets_add' => [$t2->getIdentifier(), $t3->uuid(), $t1->getIdentifier()],
    ]));
    self::assertSame([$t1->getIdentifier(), $t2->getIdentifier(), $t3->getIdentifier()], $out['referenced_tickets']);
    $ids = array_column($this->reload($deployment)->get('referenced_tickets')->getValue(), 'target_id');
    self::assertSame([$t1->id(), $t2->id(), $t3->id()], array_map('strval', $ids));
  }

  /**
   * An unknown or unreadable referenced ticket is refused, naming it.
   */
  public function testUnknownReferencedTicketIsRefused(): void {
    $t1 = $this->ticket('TU-R4');
    $deployment = $this->ticket('TU-D2', ['referenced_tickets' => [$t1->id()]]);
    [$workspace] = $this->foreignWorkspace();
    $group = $this->entity('bb_group', ['name' => 'foreign-group', 'workspace_id' => $workspace->id()]);
    $project = $this->entity('bb_project', ['name' => 'foreign-project', 'group_id' => $group->id()]);
    $foreign = $this->ticket('FX-1', ['project_id' => $project->id()])->getIdentifier();
    $this->container->get('current_user')->setAccount($this->actor);
    foreach (['NOPE-1', $foreign] as $missing) {
      $this->assertFailure($this->runTool('bakers_ticket_update', [
        'ticket' => $deployment->getIdentifier(),
        'referenced_tickets_add' => [$t1->getIdentifier(), $missing],
      ]), "Ticket $missing does not exist or is not readable.");
    }
    $ids = array_column($this->reload($deployment)->get('referenced_tickets')->getValue(), 'target_id');
    self::assertSame([(string) $t1->id()], array_map('strval', $ids));
  }

  /**
   * A reader without update access may not stamp a ticket; the error names it.
   */
  public function testReaderCannotStamp(): void {
    $this->environment('staging');
    $ref = $this->ticket('TU-R5')->getIdentifier();
    $ticket = $this->ticket('TU-D3');
    $id = $ticket->getIdentifier();
    $this->actAsReader();
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $id,
      'environments_add' => ['staging'],
    ]), "You may not change environments of ticket $id");
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $id,
      'referenced_tickets_add' => [$ref],
    ]), "You may not change referenced_tickets of ticket $id");
    $stored = $this->reload($ticket);
    self::assertTrue($stored->get('environments')->isEmpty());
    self::assertTrue($stored->get('referenced_tickets')->isEmpty());
  }

  /**
   * Environments are added by name or UUID; existing ones stay.
   */
  public function testAddsEnvironmentsKeepingExisting(): void {
    $a = $this->environment('alpha');
    $this->environment('beta');
    $c = $this->environment('gamma');
    $ticket = $this->ticket('TU-E1', ['environments' => [$a->id()]]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'environments_add' => ['beta', $c->uuid()],
    ]));
    self::assertSame(['alpha', 'beta', 'gamma'], $out['environments']);
    self::assertSame(['alpha', 'beta', 'gamma'], $this->environmentNames($ticket));
  }

  /**
   * Adding an environment the ticket already has changes nothing.
   */
  public function testAddingPresentEnvironmentChangesNothing(): void {
    $a = $this->environment('alpha');
    $ticket = $this->ticket('TU-E2', ['environments' => [$a->id()]]);
    $out = $this->outputs($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'environments_add' => ['alpha', $a->uuid()],
    ]));
    self::assertSame(['alpha'], $out['environments']);
    self::assertSame(['alpha'], $this->environmentNames($ticket));
  }

  /**
   * An environment outside the ticket's project is refused, naming it.
   */
  public function testEnvironmentOfOtherProjectIsRefused(): void {
    $a = $this->environment('alpha');
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => 'other-project',
      'group_id' => $this->project->get('group_id')->target_id,
    ]);
    $other->save();
    $foreign = $this->environment('production', (int) $other->id());
    $ticket = $this->ticket('TU-E3', ['environments' => [$a->id()]]);
    foreach (['production', $foreign->uuid(), 'nowhere'] as $value) {
      $this->assertFailure($this->runTool('bakers_ticket_update', [
        'ticket' => $ticket->getIdentifier(),
        'environments_add' => [$value],
      ]), "Environment $value is not one of the project’s environments.");
    }
    self::assertSame(['alpha'], $this->environmentNames($ticket));
  }

  /**
   * A closed done ticket refuses an environment like any other edit.
   */
  public function testClosedTicketRefusesEnvironments(): void {
    $this->environment('production');
    $ticket = $this->ticket('TU-E4', ['state' => 'done']);
    self::assertTrue($this->reload($ticket)->isClosed());
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'environments_add' => ['production'],
    ]), sprintf('Ticket %s is closed and can no longer be changed.', $ticket->getIdentifier()));
    self::assertSame([], $this->environmentNames($ticket));
  }

  /**
   * A session agent outside the run scope cannot stamp a closed done ticket.
   */
  public function testSessionAgentCannotStampOutOfScopeDoneTicket(): void {
    $this->environment('production');
    $ticket = $this->ticket('TU-E5', ['state' => 'done']);
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'session_agent', 'label' => 'Session agent'])->save();
    user_role_grant_permissions('session_agent', [
      'view bb_ticket', 'view bb_project', 'view bb_environment', 'write bakers via session scope',
    ]);
    $agent = $this->account('agent', ['session_agent']);
    $this->addMembership($this->workspace, $agent, ['member']);
    $this->addMembership($this->project->get('teams')->entity, $agent);
    $this->container->get('current_user')->setAccount($agent);
    self::assertFalse($this->container->get('bb_core.write_scope')->isTicketInScope($agent, (int) $ticket->id()));
    $this->assertFailure($this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'environments_add' => ['production'],
    ]), sprintf('Ticket %s is closed and can no longer be changed.', $ticket->getIdentifier()));
    self::assertSame([], $this->environmentNames($ticket));
  }

  /**
   * An environment of the given project, or of the actor's project.
   */
  private function environment(string $name, ?int $project_id = NULL): ContentEntityInterface {
    return $this->entity('bb_environment', [
      'name' => $name,
      'project_id' => $project_id ?? $this->project->id(),
    ]);
  }

  /**
   * The stored ticket's environment names, in order.
   *
   * @return array<string>
   *   Environment names.
   */
  private function environmentNames(BbTicketInterface $ticket): array {
    return array_map(static fn ($env) => (string) $env->label(), $this->reload($ticket)->get('environments')->referencedEntities());
  }

  /**
   * Acts as a reading-team member who may view but not update tickets.
   */
  private function actAsReader(): void {
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'viewer', 'label' => 'Viewer'])->save();
    user_role_grant_permissions('viewer', ['view bb_ticket', 'view bb_project']);
    $reader = $this->account('reader', ['viewer']);
    foreach ($etm->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $reader);
    }
    $this->container->get('current_user')->setAccount($reader);
  }

  /**
   * An active conductor in the given project, owned by the actor.
   */
  private function conductor(int $project_id): ContentEntityInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $this->randomMachineName(),
      'label' => "conductor-$project_id",
      'owner_user_id' => $this->actor->id(),
      'active' => TRUE,
      'status' => 'online',
      'project_id' => $project_id,
    ]);
    assert($conductor instanceof ContentEntityInterface);
    $conductor->save();
    return $conductor;
  }

}
