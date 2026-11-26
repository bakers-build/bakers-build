<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Kernel;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A webhook belongs to exactly one project, group or workspace, for life.
 */
#[Group('bb_webhook')]
#[RunTestsInSeparateProcesses]
final class WebhookScopeTest extends WebhookKernelTestBase {

  private const EXACTLY_ONE = 'A webhook belongs to exactly one project, group or workspace.';

  private const FOREIGN = 'The project or group must belong to the webhook\'s workspace.';

  private const IMMUTABLE = 'The scope of a webhook cannot be changed.';

  private const HTTPS = 'The URL must start with https://.';

  /**
   * A webhook with neither project nor group is the workspace's.
   */
  public function testWorkspaceScopeValid(): void {
    $webhook = $this->newWebhook('a');
    $this->assertSame([], $this->violations($webhook));
    $this->assertSame('workspace', $webhook->scope());
  }

  /**
   * A webhook with a project of its workspace is that project's.
   */
  public function testProjectScopeValid(): void {
    $webhook = $this->newWebhook('a', ['project_id' => $this->fixture('a', 'bb_project')->id()]);
    $this->assertSame([], $this->violations($webhook));
    $this->assertSame('project', $webhook->scope());
  }

  /**
   * A webhook with a group of its workspace is that group's.
   */
  public function testGroupScopeValid(): void {
    $webhook = $this->newWebhook('a', ['group_id' => $this->fixture('a', 'bb_group')->id()]);
    $this->assertSame([], $this->violations($webhook));
    $this->assertSame('group', $webhook->scope());
  }

  /**
   * Project and group together are two scopes.
   */
  public function testProjectAndGroupRejected(): void {
    $webhook = $this->newWebhook('a', [
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'group_id' => $this->fixture('a', 'bb_group')->id(),
    ]);
    $this->assertContains(self::EXACTLY_ONE, $this->violations($webhook));
  }

  /**
   * A project or group of another workspace is rejected.
   */
  public function testForeignWorkspaceProjectRejected(): void {
    $project = $this->newWebhook('a', ['project_id' => $this->fixture('b', 'bb_project')->id()]);
    $this->assertContains(self::FOREIGN, $this->violations($project));
    $group = $this->newWebhook('a', ['group_id' => $this->fixture('b', 'bb_group')->id()]);
    $this->assertContains(self::FOREIGN, $this->violations($group));
  }

  /**
   * None of the three scope fields changes after the first save.
   */
  public function testScopeChangeRejected(): void {
    $changes = [
      'workspace_id' => $this->fixture('b', 'bb_workspace')->id(),
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'group_id' => $this->fixture('a', 'bb_group')->id(),
    ];
    foreach ($changes as $field => $value) {
      $webhook = $this->newWebhook('a');
      $webhook->save();
      $webhook->set($field, $value);
      $this->assertContains(self::IMMUTABLE, $this->violations($webhook), "$field is immutable");
    }
  }

  /**
   * Only HTTPS endpoints are accepted.
   */
  public function testHttpUrlRejected(): void {
    $this->assertContains(self::HTTPS, $this->violations($this->newWebhook('a', ['url' => 'http://hooks.example.com/in'])));
  }

  /**
   * The secret is generated on the first save and kept afterwards.
   */
  public function testSecretGeneratedOnce(): void {
    $webhook = $this->newWebhook('a');
    $webhook->save();
    $secret = $webhook->getSecret();
    $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $secret);
    $webhook->set('name', 'renamed')->save();
    $this->assertSame($secret, $webhook->getSecret());
  }

  /**
   * Deleting a project, group or workspace deletes its webhooks.
   */
  public function testScopeDeleteCascades(): void {
    $owner = $this->leads['a']->id();
    $workspace = $this->fixture('a', 'bb_workspace');
    $group = $this->createEntity('bb_group', ['name' => 'doomed', 'workspace_id' => $workspace->id(), 'owner_user_id' => $owner]);
    $project = $this->createEntity('bb_project', [
      'name' => 'doomed',
      'group_id' => $group->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
      'owner_user_id' => $owner,
    ]);
    $lone = $this->createEntity('bb_workspace', ['name' => 'lone', 'owner_user_id' => $owner]);
    $hooks = [
      'project' => $this->newWebhook('a', ['project_id' => $project->id()]),
      'group' => $this->newWebhook('a', ['group_id' => $group->id()]),
      'workspace' => $this->newWebhook('a', ['workspace_id' => $lone->id()]),
      'kept' => $this->newWebhook('a'),
    ];
    foreach ($hooks as $hook) {
      $hook->save();
    }
    $project->delete();
    $group->delete();
    $lone->delete();

    $left = array_keys($this->container->get('entity_type.manager')->getStorage('bb_webhook')->loadMultiple());
    $this->assertSame([(int) $hooks['kept']->id()], array_map('intval', $left));
  }

}
