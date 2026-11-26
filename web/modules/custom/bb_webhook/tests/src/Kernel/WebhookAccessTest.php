<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Kernel;

use Drupal\bb_core\Access\BbWorkspaceCreateAccess;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\Core\Config\FileStorage;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Only a workspace Admin manages that workspace's webhooks.
 */
#[Group('bb_webhook')]
#[RunTestsInSeparateProcesses]
final class WebhookAccessTest extends WebhookKernelTestBase {

  /**
   * One saved webhook per scope of side a, keyed by scope.
   *
   * @return array<string, \Drupal\bb_webhook\Entity\BbWebhookInterface>
   *   The webhooks.
   */
  private function webhooksOfA(): array {
    $webhooks = [
      'workspace' => $this->newWebhook('a'),
      'project' => $this->newWebhook('a', ['project_id' => $this->fixture('a', 'bb_project')->id()]),
      'group' => $this->newWebhook('a', ['group_id' => $this->fixture('a', 'bb_group')->id()]),
    ];
    foreach ($webhooks as $webhook) {
      $webhook->save();
    }
    return $webhooks;
  }

  /**
   * The lead manages webhooks of every scope of the own workspace.
   */
  public function testLeadManagesAllScopes(): void {
    foreach ($this->webhooksOfA() as $scope => $webhook) {
      foreach (['view', 'update', 'delete'] as $operation) {
        $this->assertTrue($webhook->access($operation, $this->leads['a']), "lead may $operation a $scope webhook");
      }
    }
    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_webhook');
    $this->assertTrue($handler->createAccess(NULL, $this->leads['a']));
  }

  /**
   * A contributor of the same workspace is denied everything.
   */
  public function testContributorDenied(): void {
    $contributor = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $contributor, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $contributor, []);
    foreach ($this->webhooksOfA() as $scope => $webhook) {
      foreach (['view', 'update', 'delete'] as $operation) {
        $this->assertFalse($webhook->access($operation, $contributor), "contributor may not $operation a $scope webhook");
      }
    }
    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_webhook');
    $this->assertFalse($handler->createAccess(NULL, $contributor));
    foreach (['view', 'update', 'delete'] as $operation) {
      $this->assertFalse($this->webhooksOfA()['workspace']->access($operation, new AnonymousUserSession()));
    }
  }

  /**
   * The add routes' create check passes only the workspace's own Admin.
   */
  public function testAddRouteCreateAccess(): void {
    $check = $this->container->get('bb_core.workspace_create_access');
    self::assertInstanceOf(BbWorkspaceCreateAccess::class, $check);
    $workspace = $this->fixture('a', 'bb_workspace');
    $contributor = $this->member('a');
    $this->addMembership($workspace, $contributor, ['contributor']);
    $this->assertTrue($check->check('bb_webhook', $workspace, $this->leads['a'])->isAllowed());
    $this->assertFalse($check->check('bb_webhook', $workspace, $this->leads['b'])->isAllowed());
    $this->assertFalse($check->check('bb_webhook', $workspace, $contributor)->isAllowed());
  }

  /**
   * Another workspace's Admin is denied everything.
   */
  public function testForeignLeadDenied(): void {
    foreach ($this->webhooksOfA() as $scope => $webhook) {
      foreach (['view', 'update', 'delete'] as $operation) {
        $this->assertFalse($webhook->access($operation, $this->leads['b']), "foreign lead may not $operation a $scope webhook");
      }
    }
  }

  /**
   * An Admin of b who is only a Contributor of a cannot place a webhook in a.
   *
   * Create has no entity to fence, so this is the only bound on a write that
   * does not pass the add routes.
   */
  public function testForeignWorkspaceCreateRejected(): void {
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->leads['b'], ['contributor']);
    $webhook = $this->newWebhook('a', ['owner_user_id' => $this->leads['b']->id()]);
    $this->assertContains('You may not place this in that tenancy.', $this->violations($webhook, $this->leads['b']));
    $this->assertSame([], $this->violations($this->newWebhook('a'), $this->leads['a']));
  }

  /**
   * A team lead without the workspace Admin rank is denied like a Contributor.
   */
  public function testTeamLeadDenied(): void {
    $team_lead = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $team_lead, ['contributor']);
    $membership = $this->addMembership($this->fixture('a', 'bb_team'), $team_lead, ['lead']);
    $this->assertTrue($membership->hasRole('bb_team-bb_team-lead'), 'the team lead role is installed');
    foreach ($this->webhooksOfA() as $scope => $webhook) {
      foreach (['view', 'update', 'delete'] as $operation) {
        $this->assertFalse($webhook->access($operation, $team_lead), "team lead may not $operation a $scope webhook");
      }
    }
    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_webhook');
    $this->assertFalse($handler->createAccess(NULL, $team_lead));
  }

  /**
   * Webhooks are not a JSON:API or REST resource.
   */
  public function testNotExposedToJsonApi(): void {
    $this->assertTrue($this->container->get('entity_type.manager')->getDefinition('bb_webhook')->isInternal());
  }

  /**
   * Nobody reads or edits the secret through field access.
   */
  public function testSecretFieldAccessDenied(): void {
    $webhook = $this->webhooksOfA()['workspace'];
    foreach (['view', 'edit'] as $operation) {
      $this->assertFalse($webhook->get('secret')->access($operation, $this->leads['a']), "secret $operation is denied");
    }
    $this->assertTrue($webhook->get('url')->access('view', $this->leads['a']));
  }

  /**
   * Queries and each tab list only the own scope's webhooks.
   */
  public function testViewListsOnlyOwnScope(): void {
    $own = $this->webhooksOfA();
    $foreign = $this->newWebhook('b');
    $foreign->save();
    $ids = array_map(static fn (BbWebhookInterface $webhook): int => (int) $webhook->id(), $own);
    sort($ids);
    $this->assertSame($ids, $this->queryIdsAs('bb_webhook', $this->leads['a']));
    $this->assertSame([], $this->queryIdsAs('bb_webhook', new AnonymousUserSession()));

    $source = new FileStorage(DRUPAL_ROOT . '/../config/sync');
    $data = $source->read('views.view.bb_webhooks');
    self::assertIsArray($data);
    // The canvas extender's module is not under test; the query is.
    foreach (array_keys($data['display']) as $display) {
      unset($data['display'][$display]['display_options']['display_extenders']);
    }
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
    $workspace = $this->fixture('a', 'bb_workspace');
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $slug = $workspace->getSlug();
    $tabs = [
      'project_list' => [$slug, $this->fixture('a', 'bb_project')->id()],
      'group_list' => [$slug, $this->fixture('a', 'bb_group')->id()],
      'workspace_list' => [$slug],
    ];
    $this->container->get('current_user')->setAccount($this->leads['a']);
    foreach ($tabs as $display => $args) {
      $view = Views::getView('bb_webhooks');
      self::assertNotNull($view);
      $view->setDisplay($display);
      $view->preExecute($args);
      $view->execute();
      $listed = array_map(static fn ($row): int => (int) $row->_entity->id(), $view->result);
      $scope = str_replace('_list', '', $display);
      $this->assertSame([(int) $own[$scope]->id()], $listed, "$display lists only its own scope");
      // No detail page: the name opens the edit form.
      $name = (string) $view->style_plugin->getField(0, 'name');
      $this->assertStringContainsString('href="' . $own[$scope]->toUrl('edit-form')->toString() . '"', $name, "$display links the name to the edit form");
    }
  }

}
