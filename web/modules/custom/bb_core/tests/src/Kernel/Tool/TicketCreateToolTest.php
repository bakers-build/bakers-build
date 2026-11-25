<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket created through its tool carries Markdown, terms and its parent.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCreateToolTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    user_role_grant_permissions('skill_user', ['create bb_ticket']);
  }

  /**
   * Stores title, Markdown description, terms by name and the parent.
   */
  public function testCreateStoresFieldsAndTerms(): void {
    $type = $this->term('type', 'feature');
    $recipe = $this->term('recipe', 'matt');
    $parent = $this->ticket('TC-1');
    $description = "## Why\n\n- `one` \$step\n";
    $out = $this->outputs($this->runTool('bakers_ticket_create', [
      'title' => 'New work',
      'workflow' => 'bb_work',
      'description' => $description,
      'project' => $this->project->uuid(),
      'type' => 'feature',
      'recipe' => 'matt',
      'parent' => $parent->getIdentifier(),
    ]));
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    self::assertSame('New work', $stored->get('title')->value);
    self::assertSame($description, $stored->get('description')->value);
    self::assertSame('bb_rich', $stored->get('description')->format);
    self::assertSame('qualification', $stored->get('state')->value);
    self::assertSame('qualification', $out['state']);
    self::assertSame($this->project->id(), $stored->get('project_id')->target_id);
    self::assertSame($type->id(), $stored->get('ticket_type')->target_id);
    self::assertSame($recipe->id(), $stored->get('recipe')->target_id);
    self::assertSame($parent->id(), $stored->get('parent_id')->target_id);
  }

  /**
   * Blockers named by identifier or UUID are stored on the new ticket.
   */
  public function testCreatesBlockedTicket(): void {
    $first = $this->ticket('TC-B1');
    $second = $this->ticket('TC-B2');
    $out = $this->outputs($this->runTool('bakers_ticket_create', [
      'title' => 'Waits',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'blocked_by' => [$first->getIdentifier(), $second->uuid()],
    ]));
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    self::assertSame([$first->id(), $second->id()], array_map('strval', array_column($stored->get('blocked_by')->getValue(), 'target_id')));
  }

  /**
   * A blocker of another project, closed or unreadable creates nothing.
   */
  public function testRefusedBlockerCreatesNothing(): void {
    $etm = $this->container->get('entity_type.manager');
    $other = $etm->getStorage('bb_project')->create([
      'name' => 'other-project',
      'group_id' => $this->project->get('group_id')->target_id,
      'teams' => [$this->project->get('teams')->target_id],
    ]);
    $other->save();
    $elsewhere = $this->ticket('TC-OTHER', ['project_id' => $other->id()])->getIdentifier();
    $done = $this->ticket('TC-DONE', ['state' => 'done'])->getIdentifier();
    $foreign = $etm->getStorage('bb_workspace')->create([
      'name' => 'foreign',
      'slug' => 'foreign',
      'owner_user_id' => $this->account('stranger')->id(),
    ]);
    $foreign->save();
    $group = $etm->getStorage('bb_group')->create(['name' => 'foreign-group', 'workspace_id' => $foreign->id()]);
    $group->save();
    $hidden = $etm->getStorage('bb_project')->create(['name' => 'foreign-project', 'group_id' => $group->id()]);
    $hidden->save();
    $unreadable = $this->ticket('TC-HIDDEN', ['project_id' => $hidden->id()])->getIdentifier();
    $storage = $etm->getStorage('bb_ticket');
    $before = $storage->getQuery()->accessCheck(FALSE)->count()->execute();
    foreach ([
      $elsewhere => 'Choose open blocking tickets from this ticket',
      $done => 'Choose open blocking tickets from this ticket',
      $unreadable => "Ticket $unreadable does not exist or is not readable.",
      'NOPE-3' => 'Ticket NOPE-3 does not exist or is not readable.',
    ] as $blocker => $message) {
      $this->assertFailure($this->runTool('bakers_ticket_create', [
        'title' => 'Never',
        'workflow' => 'bb_work',
        'project' => $this->project->uuid(),
        'blocked_by' => [$blocker],
      ]), $message);
    }
    self::assertSame($before, $storage->getQuery()->accessCheck(FALSE)->count()->execute());
  }

  /**
   * A description at the limit is stored; an oversized create saves nothing.
   */
  public function testDescriptionByteBudget(): void {
    $body = str_repeat('é', 3072);
    $values = [
      'title' => 'Budget boundary',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'description' => $body,
    ];
    $out = $this->outputs($this->runTool('bakers_ticket_create', $values));
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    self::assertSame($body, $stored->get('description')->value);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $before = $storage->getQuery()->accessCheck(FALSE)->count()->execute();
    $values['description'] .= 'x';
    $values['recipe'] = 'oversized-create';
    $this->assertFailure($this->runTool('bakers_ticket_create', $values), 'description is 6145 UTF-8 bytes; limit 6144');
    self::assertSame($before, $storage->getQuery()->accessCheck(FALSE)->count()->execute());
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_term')->loadByProperties(['name' => 'oversized-create']));
  }

  /**
   * A carrier ticket keeps the given branch; others get the derived one.
   */
  public function testCarrierBranchIsKeptAndOtherwiseDerived(): void {
    $carrier = $this->outputs($this->runTool('bakers_ticket_create', [
      'title' => 'Release 1.2',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'branch_name' => 'release/1.2',
    ]));
    self::assertSame('release/1.2', $carrier['branch_name']);
    $derived = $this->outputs($this->runTool('bakers_ticket_create', [
      'title' => 'Plain',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
    ]));
    self::assertStringStartsWith('feat/', $derived['branch_name']);
  }

  /**
   * The project also resolves by its key.
   */
  public function testProjectByKey(): void {
    $this->project->set('key', 'TOOL')->save();
    $out = $this->outputs($this->runTool('bakers_ticket_create', [
      'title' => 'By key',
      'workflow' => 'bb_work',
      'project' => 'TOOL',
    ]));
    self::assertSame('TOOL-1', $out['identifier']);
  }

  /**
   * The result links the ticket's canonical page under its workspace slug.
   */
  public function testResultCarriesAbsoluteTicketUrl(): void {
    $this->container->get('router.builder')->rebuild();
    $this->project->set('key', 'TOOL')->save();
    $out = $this->outputs($this->runTool('bakers_ticket_create', [
      'title' => 'Linked',
      'workflow' => 'bb_work',
      'project' => 'TOOL',
    ]));
    self::assertSame('Linked', $out['title']);
    self::assertNull($out['origin']);
    self::assertMatchesRegularExpression('#^https?://[^/]+(/.*)?/tool-workspace/ticket/tool-1$#', $out['url']);
  }

  /**
   * A missing recipe term is created in the project's workspace.
   */
  public function testMissingRecipeIsCreated(): void {
    $out = $this->outputs($this->runTool('bakers_ticket_create', [
      'title' => 'New recipe',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'recipe' => 'fresh',
    ]));
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    $recipe = $stored->get('recipe')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $recipe);
    self::assertSame('fresh', $recipe->label());
    self::assertSame($this->workspace->id(), $recipe->get('workspace_id')->target_id);
  }

  /**
   * The retired names are refused, naming ship; ship and ship are saved.
   */
  public function testRetiredDeploymentNamesPointToShip(): void {
    $values = ['title' => 'Release', 'workflow' => 'bb_work', 'project' => $this->project->uuid()];
    $this->assertFailure($this->runTool('bakers_ticket_create', $values + ['type' => 'deployment']), 'The type deployment is now ship.');
    $this->assertFailure($this->runTool('bakers_ticket_create', $values + ['recipe' => 'deploy-and-release']), 'The recipe deploy-and-release is now ship.');
    $out = $this->outputs($this->runTool('bakers_ticket_create', $values + ['type' => 'ship', 'recipe' => 'ship']));
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    self::assertSame('ship', $stored->get('ticket_type')->entity?->label());
    self::assertSame('ship', $stored->get('recipe')->entity?->label());
  }

  /**
   * The workspace member with that UUID becomes the assignee.
   */
  public function testAssigneeOfWorkspaceMemberIsAssigned(): void {
    $member = $this->account('member');
    $this->addMembership($this->workspace, $member, ['contributor']);
    // The caller's read scope is memoised per request; this is a new one.
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $result = $this->runTool('bakers_ticket_create', [
      'title' => 'Mine',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'assignee' => $member->uuid(),
    ]);
    $out = $this->outputs($result);
    self::assertSame('Ticket created.', (string) $result->getMessage());
    self::assertSame($member->uuid(), $out['assignee']['uuid']);
    self::assertSame('member', $out['assignee']['name']);
    self::assertFalse($out['assignee']['service_account']);
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    self::assertSame($member->id(), $stored->get('assignee_user_id')->target_id);
  }

  /**
   * People are set by UUID only; the e-mail inputs are gone.
   */
  public function testEmailInputsAreUnknown(): void {
    $inputs = array_keys($this->container->get('plugin.manager.tool')->getDefinition('bakers_ticket_create')->getInputDefinitions());
    self::assertContains('assignee', $inputs);
    self::assertContains('reviewers', $inputs);
    self::assertNotContains('assignee_email', $inputs);
    self::assertNotContains('reviewer_emails', $inputs);
  }

  /**
   * An unknown UUID and one outside the workspace give the same answer.
   *
   * The ticket is created unassigned either way, no account is created, and
   * the response does not tell the two apart.
   */
  public function testUnassignableAssigneeLeavesTheTicketUnassigned(): void {
    $etm = $this->container->get('entity_type.manager');
    $outsider = $this->outsider();
    $users = $etm->getStorage('user')->getQuery()->accessCheck(FALSE)->count()->execute();
    $answers = [];
    foreach (['nobody' => $this->container->get('uuid')->generate(), 'outsider' => $outsider->uuid()] as $key => $uuid) {
      $result = $this->runTool('bakers_ticket_create', [
        'title' => 'Unassigned',
        'workflow' => 'bb_work',
        'project' => $this->project->uuid(),
        'assignee' => $uuid,
      ]);
      $out = $this->outputs($result);
      $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
      self::assertInstanceOf(BbTicketInterface::class, $stored);
      self::assertTrue($stored->get('assignee_user_id')->isEmpty(), $key);
      $answers[$key] = [(string) $result->getMessage(), $out['assignee'], array_keys($out)];
    }
    self::assertSame('Ticket created without an assignee: no such user can be assigned in this workspace.', $answers['nobody'][0]);
    self::assertNull($answers['nobody'][1]);
    self::assertSame($answers['nobody'], $answers['outsider']);
    self::assertSame($users, $etm->getStorage('user')->getQuery()->accessCheck(FALSE)->count()->execute());
  }

  /**
   * The workspace member with a reviewer UUID becomes a reviewer.
   */
  public function testReviewerOfWorkspaceMemberIsAdded(): void {
    $member = $this->account('member');
    $this->addMembership($this->workspace, $member, ['contributor']);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $result = $this->runTool('bakers_ticket_create', [
      'title' => 'Review mine',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'reviewers' => [$member->uuid()],
    ]);
    $out = $this->outputs($result);
    self::assertSame('Ticket created.', (string) $result->getMessage());
    self::assertSame([$member->uuid()], array_column($out['reviewers'], 'uuid'));
    self::assertSame(['member'], array_column($out['reviewers'], 'name'));
    self::assertNull($out['assignee']);
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    self::assertSame([$member->id()], array_column($stored->get('reviewers')->getValue(), 'target_id'));
  }

  /**
   * An unknown reviewer UUID and one outside the workspace add no one.
   *
   * The ticket is created either way, no account is created, and the response
   * does not tell the two apart.
   */
  public function testUnacceptableReviewerAddsNoOne(): void {
    $etm = $this->container->get('entity_type.manager');
    $outsider = $this->outsider();
    $users = $etm->getStorage('user')->getQuery()->accessCheck(FALSE)->count()->execute();
    $answers = [];
    foreach (['nobody' => $this->container->get('uuid')->generate(), 'outsider' => $outsider->uuid()] as $key => $uuid) {
      $result = $this->runTool('bakers_ticket_create', [
        'title' => 'No reviewer',
        'workflow' => 'bb_work',
        'project' => $this->project->uuid(),
        'reviewers' => [$uuid],
      ]);
      $out = $this->outputs($result);
      $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
      self::assertInstanceOf(BbTicketInterface::class, $stored);
      self::assertTrue($stored->get('reviewers')->isEmpty(), $key);
      $answers[$key] = [(string) $result->getMessage(), $out['reviewers'], array_keys($out)];
    }
    self::assertSame('Ticket created. Not every reviewer was added: no such user can be a reviewer in this workspace.', $answers['nobody'][0]);
    self::assertSame([], $answers['nobody'][1]);
    self::assertSame($answers['nobody'], $answers['outsider']);
    self::assertSame($users, $etm->getStorage('user')->getQuery()->accessCheck(FALSE)->count()->execute());
  }

  /**
   * A list with a member and an unknown UUID adds only the member.
   */
  public function testMixedReviewersAddOnlyAcceptedAccounts(): void {
    $member = $this->account('member');
    $this->addMembership($this->workspace, $member, ['contributor']);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $result = $this->runTool('bakers_ticket_create', [
      'title' => 'Mixed',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'reviewers' => [$this->container->get('uuid')->generate(), $member->uuid()],
    ]);
    $out = $this->outputs($result);
    self::assertSame('Ticket created. Not every reviewer was added: no such user can be a reviewer in this workspace.', (string) $result->getMessage());
    self::assertSame([$member->uuid()], array_column($out['reviewers'], 'uuid'));
    self::assertSame(['member'], array_column($out['reviewers'], 'name'));
  }

  /**
   * A caller without create access is refused.
   */
  public function testCallerWithoutCreateAccessFails(): void {
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'viewer', 'label' => 'Viewer'])->save();
    user_role_grant_permissions('viewer', ['view bb_ticket', 'view bb_project']);
    $this->container->get('current_user')->setAccount($this->account('reader', ['viewer']));
    $this->assertFailure($this->runTool('bakers_ticket_create', [
      'title' => 'Denied',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
    ]), 'may not create');
    self::assertEmpty($etm->getStorage('bb_ticket')->loadByProperties(['title' => 'Denied']));
  }

  /**
   * AC6: a contributor creates in every project of the workspace.
   */
  public function testCreatesInAnyPermittedProject(): void {
    $second = $this->project->createDuplicate();
    $second->set('key', 'TWO');
    $second->save();
    $this->container->get('current_user')->setAccount($this->rankedReader(['contributor']));

    foreach ([$this->project, $second] as $project) {
      $out = $this->outputs($this->runTool('bakers_ticket_create', [
        'title' => 'Allowed',
        'workflow' => 'bb_work',
        'project' => $project->uuid(),
      ]));
      $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
      self::assertInstanceOf(BbTicketInterface::class, $stored);
      self::assertSame($project->id(), $stored->get('project_id')->target_id);
    }
  }

  /**
   * AC6: a readable project without the create right is refused by name.
   *
   * The caller may create tickets elsewhere, so only this project's right
   * is missing.
   */
  public function testReadableProjectWithoutCreateRightIsRefused(): void {
    $this->project->set('key', 'TOOL')->save();
    $caller = $this->rankedReader(['member']);
    $elsewhere = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'elsewhere', 'slug' => 'elsewhere']);
    assert($elsewhere instanceof ContentEntityInterface);
    $elsewhere->save();
    $this->addMembership($elsewhere, $caller, ['contributor']);
    $this->container->get('current_user')->setAccount($caller);
    $before = $this->ticketCount();

    $this->assertFailure($this->runTool('bakers_ticket_create', [
      'title' => 'Refused',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
    ]), 'You may not create tickets in project TOOL: you lack the create-ticket right there.');
    self::assertSame($before, $this->ticketCount());
  }

  /**
   * A reader of the fixture project holding these workspace roles only.
   *
   * @param array<string> $workspace_roles
   *   Its workspace roles.
   */
  private function rankedReader(array $workspace_roles): UserInterface {
    $etm = $this->container->get('entity_type.manager');
    if ($etm->getStorage('user_role')->load('ranked') === NULL) {
      $etm->getStorage('user_role')->create(['id' => 'ranked', 'label' => 'Ranked'])->save();
      user_role_grant_permissions('ranked', ['view bb_ticket', 'view bb_project', 'view bb_term', 'use text format bb_rich']);
    }
    $reader = $this->account('ranked-' . implode('-', $workspace_roles), ['ranked']);
    $this->addMembership($this->workspace, $reader, $workspace_roles);
    $team = $this->project->get('teams')->entity;
    assert($team instanceof ContentEntityInterface);
    $this->addMembership($team, $reader);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    return $reader;
  }

  /**
   * The number of tickets, access-unchecked.
   */
  private function ticketCount(): int {
    return count($this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->getQuery()->accessCheck(FALSE)->execute());
  }

  /**
   * An active account that belongs to another workspace only.
   */
  private function outsider(): UserInterface {
    $elsewhere = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'elsewhere', 'slug' => 'elsewhere']);
    assert($elsewhere instanceof ContentEntityInterface);
    $elsewhere->save();
    $outsider = $this->account('outsider');
    $this->addMembership($elsewhere, $outsider, ['contributor']);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    return $outsider;
  }

}
