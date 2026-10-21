<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Entity\OgRole;
use Drupal\views\Views;
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
   * A row's operations render as one action menu; Create ticket opens a dialog.
   */
  public function testRowActionsAreAnActionMenu(): void {
    $template = $this->workspaceTemplate('a');
    $view = Views::getView('bb_ticket_templates');
    self::assertNotNull($view);
    $view->setDisplay('workspace_list');
    $view->setArguments(['space-a']);
    $view->execute();
    $row = NULL;
    foreach ($view->result as $result) {
      if ((string) $result->_entity->id() === (string) $template->id()) {
        $row = $result;
      }
    }
    self::assertNotNull($row, 'The template is listed.');

    // The operations element is the theme's: bb_theme renders it.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $build = $view->field['operations']->render($row);
    self::assertIsArray($build);
    self::assertSame('operations', $build['#type'] ?? NULL, 'The row keeps core entity operations.');
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    self::assertStringContainsString('data-action-menu', $html, 'The operations render as the action menu.');
    self::assertStringContainsString('aria-label="Actions for workspace-template-a"', $html, 'Each row menu names its row.');
    self::assertSame(4, substr_count($html, 'role="menuitem"'), 'Create ticket, Settings, Delete and View.');
    self::assertMatchesRegularExpression('#<a[^>]*data-hx-get="[^"]*_wrapper_format=island_dialog[^"]*"[^>]*role="menuitem"[^>]*>\s*Create ticket#', $html);
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
      'workflow' => 'bb_feature',
      'target_state' => 'qualification',
      'workspace_id' => $this->fixture($side, 'bb_workspace')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
  }

}
