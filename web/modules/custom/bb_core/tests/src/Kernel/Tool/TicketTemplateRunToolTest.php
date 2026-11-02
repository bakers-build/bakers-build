<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A template run through its tool creates one ticket with the overrides.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTemplateRunToolTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_ticket_template');
    user_role_grant_permissions('skill_user', [
      'create bb_ticket', 'use bb_ticket_template', 'view bb_ticket_template', 'view bb_conductor',
    ]);
  }

  /**
   * The tool takes the template and the CLI's overrides, nothing else.
   */
  public function testInputAllowlist(): void {
    $tool = $this->container->get('plugin.manager.tool')->createInstance('bakers_ticket_template_run');
    self::assertSame(
      ['template', 'title', 'description', 'workflow', 'project', 'conductor', 'labels', 'target_state'],
      array_keys($tool->getInputDefinitions()),
    );
  }

  /**
   * Overrides by UUID reach the new ticket; uuid and identifier come back.
   */
  public function testRunAppliesOverrides(): void {
    $template = $this->template();
    $label = $this->term('label', 'nightly');
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => 'node-a',
      'label' => 'node-a',
      'owner_user_id' => $this->actor->id(),
      'status' => 'online',
      'project_id' => $this->project->id(),
    ]);
    $conductor->save();

    $out = $this->outputs($this->runTool('bakers_ticket_template_run', [
      'template' => $template->uuid(),
      'title' => 'Report {{month}}',
      'description' => 'Custom body',
      'project' => $this->project->uuid(),
      'conductor' => $conductor->uuid(),
      'labels' => [$label->uuid()],
      'target_state' => 'qualification',
    ]));

    $ticket = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $out['uuid']);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertSame(['uuid', 'identifier'], array_keys($out));
    self::assertSame($ticket->getIdentifier(), $out['identifier']);
    self::assertStringStartsWith('Report 20', (string) $ticket->label());
    self::assertSame('Custom body', trim((string) $ticket->get('description')->value));
    self::assertEquals($conductor->id(), $ticket->get('conductor_id')->target_id);
    self::assertEquals([$label->id()], array_column($ticket->get('labels')->getValue(), 'target_id'));
    self::assertEquals($template->id(), $ticket->get('template_id')->target_id);
  }

  /**
   * An actor without the template permission, or an unknown template, fails.
   */
  public function testDeniedActorCreatesNothing(): void {
    $template = $this->template();
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'viewer', 'label' => 'Viewer'])->save();
    user_role_grant_permissions('viewer', [
      'view bb_ticket', 'view bb_project', 'view bb_ticket_template', 'create bb_ticket',
    ]);
    $this->container->get('current_user')->setAccount($this->account('reader', ['viewer']));

    $this->assertFailure($this->runTool('bakers_ticket_template_run', ['template' => $template->uuid()]), 'use bb_ticket_template');
    $unknown = '00000000-0000-4000-8000-000000000000';
    $this->container->get('current_user')->setAccount($this->actor);
    $this->assertFailure($this->runTool('bakers_ticket_template_run', ['template' => $unknown]), $unknown);
    self::assertSame([], $etm->getStorage('bb_ticket')->loadMultiple());
  }

  /**
   * An unknown or foreign reference and an invalid override leave no ticket.
   */
  public function testInvalidReferenceLeavesNoTicket(): void {
    $template = $this->template();
    $etm = $this->container->get('entity_type.manager');
    $unknown = '00000000-0000-4000-8000-000000000000';
    $this->assertFailure($this->runTool('bakers_ticket_template_run', [
      'template' => $template->uuid(),
      'project' => $unknown,
    ]), sprintf('Project %s does not exist or is not readable.', $unknown));

    // A project of a workspace the actor is not a member of is unreadable.
    $this->container->get('current_user')->setAccount($this->account('stranger'));
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'foreign', 'slug' => 'foreign']);
    $workspace->save();
    $group = $etm->getStorage('bb_group')->create(['name' => 'foreign', 'workspace_id' => $workspace->id()]);
    $group->save();
    $foreign = $etm->getStorage('bb_project')->create(['name' => 'foreign', 'group_id' => $group->id()]);
    $foreign->save();
    $this->container->get('current_user')->setAccount($this->actor);
    $this->assertFailure($this->runTool('bakers_ticket_template_run', [
      'template' => $template->uuid(),
      'project' => $foreign->uuid(),
    ]), 'does not exist or is not readable');

    $this->assertFailure($this->runTool('bakers_ticket_template_run', [
      'template' => $template->uuid(),
      'target_state' => 'bogus',
    ]), 'is not reachable in workflow');
    self::assertSame([], $etm->getStorage('bb_ticket')->loadMultiple());
  }

  /**
   * Creates an enabled template of the actor's project.
   */
  private function template(): BbTicketTemplateInterface {
    $template = $this->container->get('entity_type.manager')->getStorage('bb_ticket_template')->create([
      'name' => 'tpl',
      'enabled' => TRUE,
      'title_pattern' => 'Ticket',
      'description' => ['value' => 'Body', 'format' => 'bb_rich'],
      'workflow' => 'bb_work',
      'target_state' => 'qualification',
      'project_id' => $this->project->id(),
      'owner_user_id' => $this->actor->id(),
    ]);
    assert($template instanceof BbTicketTemplateInterface);
    $template->save();
    return $template;
  }

}
