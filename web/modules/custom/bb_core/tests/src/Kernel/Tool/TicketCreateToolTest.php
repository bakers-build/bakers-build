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
