<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Updating a ticket through its tool changes only the given fields.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketUpdateToolTest extends BakersToolTestBase {

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
      'identifier' => $ticket->getIdentifier(),
      'title' => 'Clarified title',
      'description' => 'Clarified *ask*.',
      'conductor' => NULL,
      'labels' => [],
      'frozen' => FALSE,
    ], $out);
    $stored = $this->reload($ticket);
    self::assertSame('Clarified title', $stored->label());
    self::assertSame('Clarified *ask*.', $stored->get('description')->value);
    self::assertSame((string) $this->actor->id(), (string) $stored->get('assignee_user_id')->target_id);
    self::assertSame($ticket->get('state')->value, $stored->get('state')->value);
    self::assertTrue($stored->get('conductor_id')->isEmpty());
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
    ]), 'Give a title, a description, a conductor, labels to add or remove, or frozen.');
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
   * The tool offers no input for state, assignee, terms, links or approvals.
   */
  public function testInputsAreLimitedToEditableFields(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_ticket_update');
    self::assertSame(['ticket', 'title', 'description', 'conductor', 'labels_add', 'labels_remove', 'frozen'], array_keys($definition->getInputDefinitions()));
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
