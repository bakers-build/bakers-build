<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Entity\OgRole;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The workspace Templates page lists the workspace's workspace templates.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTemplateWorkspaceListTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;
  use ListRowLinkTestTrait;
  use DetailActionsTestTrait;

  /**
   * {@inheritdoc}
   *
   * The shipped view composes a display_builder tree, so its modules load.
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'display_builder', 'display_builder_views', 'island',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->installConfig(['views']);
    $this->installShippedView('views.view.bb_ticket_templates');
    $this->container->get('current_user')->setAccount($this->createAccount('template-admin', ['administer bakers']));
  }

  /**
   * Only this workspace's workspace templates; project templates stay away.
   */
  public function testWorkspaceListShowsOnlyWorkspaceTemplates(): void {
    $mine = $this->workspaceTemplate('a');
    $theirs = $this->workspaceTemplate('b');

    $ids = $this->viewResultIds('bb_ticket_templates', ['space-a'], 'workspace_list');

    self::assertContains((string) $mine->id(), $ids);
    self::assertNotContains((string) $theirs->id(), $ids);
    self::assertNotContains((string) $this->fixture('a', 'bb_ticket_template')->id(), $ids, 'Project templates stay on their project tab.');
  }

  /**
   * The tab needs the view right in its own workspace, not in any workspace.
   */
  public function testTabNeedsTheViewRightInThatWorkspace(): void {
    $role = OgRole::load('bb_workspace-bb_workspace-contributor');
    self::assertNotNull($role);
    $role->grantPermission('view bb_ticket_template')->save();
    $account = $this->member('b');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $account, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['guest']);
    $this->container->get('router.builder')->rebuild();
    $access = $this->container->get('access_manager');

    self::assertTrue($access->checkNamedRoute('view.bb_ticket_templates.workspace_list', ['bb_workspace' => 'space-b'], $account));
    self::assertFalse($access->checkNamedRoute('view.bb_ticket_templates.workspace_list', ['bb_workspace' => 'space-a'], $account));
  }

  /**
   * A row is one link to the template; its actions are on the detail.
   */
  public function testRowIsOneLinkToTheTemplate(): void {
    $template = $this->workspaceTemplate('a');

    $html = $this->renderListDisplay('bb_ticket_templates', 'workspace_list', ['space-a']);

    $this->assertRowsLinkOnlyToTheirDetail($html, [$template->toUrl()->toString()]);
  }

  /**
   * Delete moved from the row to the detail; a guest gets no action there.
   */
  public function testDetailOffersDeleteOnlyToWhoMayDelete(): void {
    $template = $this->workspaceTemplate('a');
    $delete = $template->toUrl('delete-form')->toString();

    self::assertSame($delete, $this->detailActions('bb_ticket_template_actions', $template)['delete']['#props']['href'] ?? NULL);

    $role = OgRole::load('bb_workspace-bb_workspace-guest');
    self::assertNotNull($role);
    $role->grantPermission('view bb_ticket_template')->save();
    $guest = $this->createAccount('north-guest', []);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $this->container->get('current_user')->setAccount($guest);
    self::assertTrue($template->access('view', $guest), 'The guest reads the detail.');
    self::assertSame([], $this->detailActions('bb_ticket_template_actions', $template));
    self::assertFalse($template->toUrl('delete-form')->access($guest), 'The delete route stays denied.');
  }

  /**
   * Creates an enabled workspace template.
   */
  private function workspaceTemplate(string $side): ContentEntityInterface {
    return $this->createEntity('bb_ticket_template', [
      'name' => "workspace-template-$side",
      'enabled' => TRUE,
      'title_pattern' => 'From the workspace',
      'description' => ['value' => 'Body', 'format' => 'plain_text'],
      'workflow' => 'bb_work',
      'target_state' => 'qualification',
      'workspace_id' => $this->fixture($side, 'bb_workspace')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
  }

}
