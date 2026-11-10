<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
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
   * The workspace member with that e-mail address becomes the assignee.
   */
  public function testAssigneeEmailOfWorkspaceMemberIsAssigned(): void {
    $member = $this->account('member');
    $member->set('mail', 'member@example.test')->save();
    $this->addMembership($this->workspace, $member, ['contributor']);
    // The caller's read scope is memoised per request; this is a new one.
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $result = $this->runTool('bakers_ticket_create', [
      'title' => 'Mine',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'assignee_email' => 'Member@Example.TEST',
    ]);
    $out = $this->outputs($result);
    self::assertSame('Ticket created.', (string) $result->getMessage());
    self::assertSame('member', $out['assignee']);
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    self::assertSame($member->id(), $stored->get('assignee_user_id')->target_id);
  }

  /**
   * An unknown address and one outside the workspace give the same answer.
   *
   * The ticket is created unassigned either way, no account is created, and
   * the response does not tell the two apart.
   */
  public function testUnassignableAssigneeEmailLeavesTheTicketUnassigned(): void {
    $etm = $this->container->get('entity_type.manager');
    $elsewhere = $etm->getStorage('bb_workspace')->create(['name' => 'elsewhere', 'slug' => 'elsewhere']);
    assert($elsewhere instanceof ContentEntityInterface);
    $elsewhere->save();
    $outsider = $this->account('outsider');
    $outsider->set('mail', 'outsider@example.test')->save();
    $this->addMembership($elsewhere, $outsider, ['contributor']);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $users = $etm->getStorage('user')->getQuery()->accessCheck(FALSE)->count()->execute();
    $answers = [];
    foreach (['nobody@example.test', 'outsider@example.test'] as $email) {
      $result = $this->runTool('bakers_ticket_create', [
        'title' => 'Unassigned',
        'workflow' => 'bb_work',
        'project' => $this->project->uuid(),
        'assignee_email' => $email,
      ]);
      $out = $this->outputs($result);
      $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['id']);
      self::assertInstanceOf(BbTicketInterface::class, $stored);
      self::assertTrue($stored->get('assignee_user_id')->isEmpty(), $email);
      $answers[$email] = [(string) $result->getMessage(), $out['assignee'], array_keys($out)];
    }
    self::assertSame('Ticket created without an assignee: no account with this e-mail address can be assigned in this workspace.', $answers['nobody@example.test'][0]);
    self::assertNull($answers['nobody@example.test'][1]);
    self::assertSame($answers['nobody@example.test'], $answers['outsider@example.test']);
    self::assertSame($users, $etm->getStorage('user')->getQuery()->accessCheck(FALSE)->count()->execute());
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

}
