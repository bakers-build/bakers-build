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
    self::assertSame('member', $out['assignee']);
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
    self::assertSame(['member'], $out['reviewers']);
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
    self::assertSame(['member'], $out['reviewers']);
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
