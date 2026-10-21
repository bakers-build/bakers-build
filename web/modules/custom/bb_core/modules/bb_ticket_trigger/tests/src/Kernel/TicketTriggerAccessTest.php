<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * Ticket triggers: scoped management, execution identity, activation gate.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTriggerAccessTest extends KernelTestBase {

  use TicketTriggerTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'serialization', 'options', 'entity',
    'state_machine', 'link', 'text', 'filter', 'markdown_easy', 'field', 'og',
    'plugin', 'consumers', 'simple_oauth', 'views', 'island', 'bb_core',
    'bb_api_key', 'bb_ticket_trigger',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installTriggerWorld();
    $this->freezeTriggerTime('2026-10-20T00:00:00Z');
  }

  /**
   * Saves a disabled trigger on a side's template.
   */
  private function savedTrigger(string $side): BbTicketTriggerInterface {
    $trigger = $this->newTrigger($side);
    $trigger->save();
    return $trigger;
  }

  /**
   * A lead manages triggers of their own workspace only.
   */
  public function testLeadManagesOnlyOwnWorkspaceTriggers(): void {
    $own = $this->savedTrigger('a');
    $foreign = $this->savedTrigger('b');
    $lead = $this->lead('a');
    foreach (['view', 'update', 'delete'] as $operation) {
      $this->assertTrue($own->access($operation, $lead), "lead may $operation an own trigger");
      $this->assertFalse($foreign->access($operation, $lead), "lead may not $operation a foreign trigger");
    }
    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket_trigger');
    $this->assertTrue($handler->createAccess('template', $lead));
  }

  /**
   * A contributor sees triggers but cannot change them; anonymous sees none.
   */
  public function testContributorViewsOnlyAndAnonymousIsDenied(): void {
    $trigger = $this->savedTrigger('a');
    $contributor = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $contributor, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $contributor, []);

    $this->assertTrue($trigger->access('view', $contributor));
    $this->assertFalse($trigger->access('update', $contributor));
    $this->assertFalse($trigger->access('delete', $contributor));
    $anonymous = new AnonymousUserSession();
    foreach (['view', 'update', 'delete'] as $operation) {
      $this->assertFalse($trigger->access($operation, $anonymous));
    }
  }

  /**
   * A collection query is narrowed to the account's readable templates.
   */
  public function testQueryIsScopedToReadableTemplates(): void {
    $own = $this->savedTrigger('a');
    $this->savedTrigger('b');
    $this->assertSame([(int) $own->id()], $this->queryIdsAs('bb_ticket_trigger', $this->lead('a')));
    $this->assertSame([], $this->queryIdsAs('bb_ticket_trigger', new AnonymousUserSession()));
  }

  /**
   * Only an active service account of the template's workspace may execute.
   */
  public function testExecutionIdentityMustBeOwnActiveServiceAccount(): void {
    $own = $this->serviceAccount('a');
    $foreign = $this->serviceAccount('b');
    $blocked = $this->serviceAccount('a', 'guest');
    $this->serviceAccounts()->disable($blocked, $this->lead('a'));

    $this->assertSame([], $this->triggerViolations($this->newTrigger('a', ['actor_uid' => $own->id()])));
    foreach ([$this->lead('a'), $foreign, $blocked] as $actor) {
      $messages = $this->triggerViolations($this->newTrigger('a', ['actor_uid' => $actor->id()]));
      $this->assertContains('The service account must be an active service account of this workspace.', $messages, $actor->getAccountName() . ' is rejected');
    }
  }

  /**
   * Enabling requires every prerequisite; the same values save disabled.
   */
  public function testActivationGateRejectsIncompleteTriggers(): void {
    $actor = $this->serviceAccount('a');
    $guest = $this->serviceAccount('a', 'guest');
    $unknown = ['plugin_id' => 'missing_plugin', 'plugin_configuration' => []];
    $invalid = ['plugin_id' => 'schedule', 'plugin_configuration' => ['time' => '25:00']];
    $cases = [
      'no actor' => [],
      'unknown type' => ['actor_uid' => $actor->id(), 'trigger_type' => $unknown],
      'invalid settings' => ['actor_uid' => $actor->id(), 'trigger_type' => $invalid],
      'guest rank' => ['actor_uid' => $guest->id()],
    ];
    foreach ($cases as $label => $values) {
      $enabled = $this->newTrigger('a', ['enabled' => TRUE] + $values);
      $this->assertNotSame([], $this->triggerViolations($enabled), "$label blocks activation");
      $disabled = $this->newTrigger('a', ['enabled' => FALSE] + $values);
      $this->assertSame([], $this->triggerViolations($disabled), "$label saves disabled");
    }

    $template = $this->triggerTemplate('a');
    $template->set('enabled', FALSE)->save();
    $trigger = $this->newTrigger('a', ['enabled' => TRUE, 'actor_uid' => $actor->id()]);
    $this->assertNotSame([], $this->triggerViolations($trigger), 'a disabled template blocks activation');
  }

  /**
   * A Contributor service account outside the project's team stays paused.
   */
  public function testServiceAccountWithoutTeamMembershipCannotBeActivated(): void {
    $actor = $this->serviceAccount('a');
    Og::getMembership($this->fixture('a', 'bb_team'), $actor, OgMembershipInterface::ALL_STATES)?->delete();

    $enabled = $this->newTrigger('a', ['enabled' => TRUE, 'actor_uid' => $actor->id()]);
    $this->assertNotSame([], $this->triggerViolations($enabled), 'no team membership blocks activation');
    $disabled = $this->newTrigger('a', ['enabled' => FALSE, 'actor_uid' => $actor->id()]);
    $this->assertSame([], $this->triggerViolations($disabled), 'no team membership saves disabled');
  }

  /**
   * A trigger of an unavailable type offers no Edit; Pause and Delete stay.
   */
  public function testUnavailableTypeCannotBeEdited(): void {
    $trigger = $this->savedTrigger('a');
    $this->container->get('database')->update('bb_ticket_trigger')
      ->fields(['trigger_type__plugin_id' => 'missing_plugin'])
      ->condition('id', $trigger->id())
      ->execute();
    $trigger = $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->loadUnchanged($trigger->id());
    $this->assertInstanceOf(BbTicketTriggerInterface::class, $trigger);
    $lead = $this->lead('a');
    $this->container->get('router.builder')->rebuild();

    $this->assertFalse($trigger->access('update', $lead), 'no Edit operation');
    $this->assertTrue($trigger->access('toggle', $lead), 'Pause stays');
    $this->assertTrue($trigger->access('delete', $lead), 'Delete stays');
    // The routes' workspace guard needs the slug the fixture leaves empty.
    $this->fixture('a', 'bb_workspace')->set('slug', 'workspace-a')->save();
    $parameters = ['bb_workspace' => 'workspace-a'] + $trigger->toUrl('edit-form')->getRouteParameters();
    $this->assertFalse(Url::fromRoute('entity.bb_ticket_trigger.edit_form', $parameters)->access($lead), 'the edit route is denied');
    $this->assertTrue(Url::fromRoute('entity.bb_ticket_trigger.toggle_form', $parameters)->access($lead), 'the pause route stays open');
    $this->assertTrue(Url::fromRoute('entity.bb_ticket_trigger.delete_form', $parameters)->access($lead), 'the delete route stays open');
  }

  /**
   * Enabling, editing and pausing keep `next_run` in step.
   */
  public function testNextRunFollowsEnableEditAndPause(): void {
    $trigger = $this->newTrigger('a', ['actor_uid' => $this->serviceAccount('a')->id(), 'enabled' => TRUE]);
    $trigger->save();
    $this->assertSame((new \DateTimeImmutable('2026-11-01T08:00:00Z'))->getTimestamp(), $trigger->getNextRun());

    $trigger->set('trigger_type', [
      'plugin_id' => 'schedule',
      'plugin_configuration' => [
        'frequency' => 'monthly',
        'day' => '1',
        'time' => '10:30',
        'timezone' => 'Europe/Berlin',
      ],
    ])->save();
    $this->assertSame((new \DateTimeImmutable('2026-11-01T09:30:00Z'))->getTimestamp(), $trigger->getNextRun());

    $trigger->set('enabled', FALSE)->save();
    $this->assertNull($trigger->getNextRun());
  }

  /**
   * The template and the trigger type cannot change after the first save.
   */
  public function testTemplateAndTypeAreImmutable(): void {
    $trigger = $this->savedTrigger('a');
    $trigger->set('template_id', $this->triggerTemplate('b')->id());
    $this->assertNotSame([], $this->triggerViolations($trigger));

    $trigger = $this->savedTrigger('a');
    $trigger->set('trigger_type', ['plugin_id' => 'missing_plugin', 'plugin_configuration' => []]);
    $this->assertNotSame([], $this->triggerViolations($trigger));
  }

  /**
   * A trigger is a `template` bundle anchored on its own workspace.
   */
  public function testTriggerIsTemplateBundleAnchoredOnItsWorkspace(): void {
    $trigger = $this->savedTrigger('a');
    $this->assertSame('template', $trigger->bundle());
    $resolver = $this->container->get(WorkspaceResolverInterface::class);
    $this->assertSame($this->fixture('a', 'bb_workspace')->id(), $resolver->resolve($trigger)?->id());
  }

  /**
   * The workspace cannot change, and it must be the target's.
   */
  public function testWorkspaceIsImmutableAndMatchesTheTarget(): void {
    $trigger = $this->savedTrigger('a');
    $trigger->set('workspace_id', $this->fixture('b', 'bb_workspace')->id());
    $this->assertContains('The workspace of a trigger cannot be changed.', $this->triggerViolations($trigger));

    $misplaced = $this->newTrigger('a', ['workspace_id' => $this->fixture('b', 'bb_workspace')->id()]);
    $this->assertContains("The trigger's target is not in the trigger's workspace.", $this->triggerViolations($misplaced, $this->lead('b')));
  }

  /**
   * The target bundle of a saved trigger cannot change.
   */
  public function testBundleIsImmutable(): void {
    $trigger = $this->savedTrigger('a');
    $trigger->set('bundle', 'other_target');
    $this->assertContains('The target of a trigger cannot be changed.', $this->triggerViolations($trigger));
  }

  /**
   * A lead cannot anchor a trigger in another workspace.
   */
  public function testForeignLeadCannotCreateTriggerInAnotherWorkspace(): void {
    $this->assertNotSame([], $this->triggerViolations($this->newTrigger('a'), $this->lead('b')));
    $this->assertSame([], $this->triggerViolations($this->newTrigger('a'), $this->lead('a')));
  }

  /**
   * The Triggers view lists no foreign trigger.
   */
  public function testTriggersViewHidesForeignTriggers(): void {
    $own = $this->savedTrigger('a');
    // Raw config, as WorkspaceReadScopeViewsTest imports its Views: only the
    // query is under test.
    $values = Yaml::parseFile(dirname($this->root) . '/config/sync/views.view.bb_ticket_triggers.yml');
    unset($values['_core']);
    // Display Builder is not installed here; its extender only renders.
    foreach (array_keys($values['display']) as $display) {
      unset($values['display'][$display]['display_options']['display_extenders']);
    }
    $this->config('views.view.bb_ticket_triggers')->setData($values)->save();
    $switcher = $this->container->get('account_switcher');
    $workspace = (string) $this->fixture('a', 'bb_workspace')->id();
    $template = (string) $this->triggerTemplate('a')->id();
    $switcher->switchTo($this->member('b'));
    try {
      $this->assertSame([], views_get_view_result('bb_ticket_triggers', 'template_list', $workspace, $template));
    }
    finally {
      $switcher->switchBack();
    }
    $switcher->switchTo($this->lead('a'));
    try {
      $rows = views_get_view_result('bb_ticket_triggers', 'template_list', $workspace, $template);
      $this->assertSame([(int) $own->id()], array_map(static fn ($row): int => (int) $row->_entity->id(), $rows));
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Deleting a template deletes its triggers.
   */
  public function testTriggersAreDeletedWithTheirTemplate(): void {
    $trigger = $this->savedTrigger('a');
    $this->triggerTemplate('a')->delete();
    $this->assertNull($this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->loadUnchanged($trigger->id()));
  }

}
