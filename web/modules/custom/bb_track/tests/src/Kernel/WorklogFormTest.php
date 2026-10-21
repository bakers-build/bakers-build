<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Form\WorklogDeleteForm;
use Drupal\bb_track\Form\WorklogForm;
use Drupal\bb_track\Form\WorklogFormLayout;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;

/**
 * Native add/edit/delete forms for Worklog.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogFormTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;
  use BillingAccountFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file',
    'image',
    'system',
    'user',
    'field',
    'options',
    'text',
    'link',
    'filter',
    'datetime',
    'entity',
    'state_machine',
    'og',
    'views',
    'island',
    'views_filters_summary',
    'ui_patterns',
    'display_builder',
    'ui_patterns_views',
    'display_builder_views',
    'bb_core',
    'bb_track',
    'bb_track_test',
  ];

  /**
   * Account that owns fixture groups so actors are not auto-membered.
   */
  private UserInterface $worldOwner;

  /**
   * Employee A: workspace lead who records time.
   */
  private UserInterface $employee;

  /**
   * Employee B: peer in the same workspace.
   */
  private UserInterface $peer;

  /**
   * Workspace under test.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * Second workspace used for cross-tenant URLs.
   */
  private BbWorkspaceInterface $otherWorkspace;

  /**
   * Permitted project P.
   */
  private BbProjectInterface $projectP;

  /**
   * Permitted project Q in the same workspace.
   */
  private BbProjectInterface $projectQ;

  /**
   * Project in the other workspace.
   */
  private BbProjectInterface $foreignProject;

  /**
   * Ticket on project P.
   */
  private BbTicketInterface $ticketT;

  /**
   * Ticket on project Q.
   */
  private BbTicketInterface $ticketQ;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user',
      'file',
      'og_membership',
      'bb_workspace',
      'bb_group',
      'bb_team',
      'bb_project',
      'bb_ticket',
      'bb_track_submission', 'bb_track_account', 'bb_track_worklog',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['system', 'user', 'filter', 'views']);
    $this->installOgScopeFixture();
    $this->installShippedOverviewView();
    $this->installMinimalMyWorkView();

    $permissions = [
      'record own worklog',
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ];
    $this->createUser([], 'uid1-dummy');
    $world_owner = $this->createUser([], 'world-owner');
    $employee = $this->createUser($permissions, 'employee-a', FALSE, [
      'timezone' => 'Europe/Berlin',
    ]);
    $peer = $this->createUser($permissions, 'employee-b');
    self::assertInstanceOf(UserInterface::class, $world_owner);
    self::assertInstanceOf(UserInterface::class, $employee);
    self::assertInstanceOf(UserInterface::class, $peer);
    $this->worldOwner = $world_owner;
    $this->employee = $employee;
    $this->peer = $peer;

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')->create([
      'name' => 'Workspace A',
      'slug' => 'workspace-a',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $other = $storage->getStorage('bb_workspace')->create([
      'name' => 'Workspace B',
      'slug' => 'workspace-b',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $other->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $other);
    $this->otherWorkspace = $other;

    $group_g1 = $this->createGroup('Customer G1', $this->workspace);
    $group_g3 = $this->createGroup('Customer G3', $this->workspace);
    $foreign_group = $this->createGroup('Foreign customer', $this->otherWorkspace);

    $this->projectP = $this->createProject('PRJP', $group_g1);
    $this->projectQ = $this->createProject('PRJQ', $group_g3);
    $this->foreignProject = $this->createProject('PRJF', $foreign_group);

    $this->ticketT = $this->createTicket('Ticket T', $this->projectP);
    $this->ticketQ = $this->createTicket('Ticket Q', $this->projectQ);

    $this->addMembership($this->workspace, $this->employee, ['lead']);
    $this->addMembership($this->workspace, $this->peer, ['lead']);
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Submitting the add form persists canonical values and redirects to edit.
   */
  public function testAddFormSavesAndRedirects(): void {
    $this->actAs($this->employee);
    $form_state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => $this->autocomplete($this->projectP),
      'ticket' => $this->autocomplete($this->ticketT),
      'description' => 'Review changes',
    ]);
    self::assertSame([], $form_state->getErrors());
    $ids = $this->worklogIds();
    self::assertCount(1, $ids);
    $entry = Worklog::load(reset($ids));
    self::assertInstanceOf(Worklog::class, $entry);
    self::assertSame('2026-10-06', $entry->get('work_date')->value);
    self::assertSame(5400, (int) $entry->get('duration_seconds')->value);
    self::assertSame((int) $this->projectP->id(), (int) $entry->get('project_id')->target_id);
    self::assertSame((int) $this->ticketT->id(), (int) $entry->get('ticket_id')->target_id);
    self::assertSame('Review changes', $entry->get('description')->value);
    self::assertSame('manual', $entry->get('derivation')->value);
    self::assertSame('recorded', $entry->get('state')->value);
    self::assertSame((int) $this->employee->id(), (int) $entry->get('owner_user_id')->target_id);
  }

  /**
   * An edit updates duration and project, then delete removes only that row.
   */
  public function testEditThenDelete(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 5400,
      'description' => 'Review changes',
    ]);
    $peer_entry = $this->createRecorded($this->peer, [
      'duration_seconds' => 1800,
      'description' => 'Peer work',
    ]);

    $form_state = $this->submitEdit($entry, [
      'work_date' => '2026-10-07',
      'duration' => '2:15',
      'project' => $this->autocomplete($this->projectQ),
      'description' => 'Corrected review',
    ]);
    self::assertSame([], $form_state->getErrors());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache([$entry->id()]);
    $reloaded = $storage->load($entry->id());
    self::assertInstanceOf(Worklog::class, $reloaded);
    self::assertSame(8100, (int) $reloaded->get('duration_seconds')->value);
    self::assertSame((int) $this->projectQ->id(), (int) $reloaded->get('project_id')->target_id);
    self::assertSame('Corrected review', $reloaded->get('description')->value);

    $delete_state = $this->submitDelete($reloaded);
    self::assertSame([], $delete_state->getErrors());
    $delete_state->setProgrammed(FALSE);
    $redirect = $delete_state->getRedirect();
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('bb_track.worklog.add', $redirect->getRouteName());
    self::assertSame([], $redirect->getRouteParameters());
    $messages = $this->container->get('messenger')->all();
    $status = array_map('strval', $messages['status'] ?? []);
    self::assertContains('Time entry deleted.', $status);
    $storage->resetCache([$reloaded->id(), $peer_entry->id()]);
    self::assertNull($storage->load($reloaded->id()));
    self::assertInstanceOf(Worklog::class, $storage->load($peer_entry->id()));
  }

  /**
   * Invalid duration stays on the form and writes nothing.
   */
  public function testInvalidDurationLeavesStorageUnchanged(): void {
    $this->actAs($this->employee);
    $form_state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '0:00',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Review changes',
    ]);
    self::assertNotSame([], $form_state->getErrors());
    self::assertArrayHasKey('duration', $form_state->getErrors());
    self::assertSame([], $this->worklogIds());
  }

  /**
   * A malformed duration and an out-of-range one get distinct messages.
   */
  public function testDurationErrorDistinguishesFormatFromRange(): void {
    $this->actAs($this->employee);
    $malformed = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => 'nope',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Review changes',
    ]);
    self::assertStringContainsString('hours:minutes', (string) $malformed->getErrors()['duration']);
    $over_cap = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '24:01',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Review changes',
    ]);
    self::assertStringContainsString('between 0:01 and 24:00', (string) $over_cap->getErrors()['duration']);
    self::assertSame([], $this->worklogIds());
  }

  /**
   * An approved entry renders without save or delete actions.
   */
  public function testApprovedFormIsReadOnly(): void {
    $this->actAs($this->employee);
    $entry = $this->createApproved();
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertArrayNotHasKey('submit', $form['actions']);
    self::assertArrayNotHasKey('delete', $form);
    self::assertArrayHasKey('approved', $form);
    self::assertStringContainsString('Approved', (string) $form['approved']['#markup']);
    self::assertSame('Approved', (string) $form['context']['state']['#props']['label']);
  }

  /**
   * The edit form leads with its fixed context and keeps targets behind Change.
   */
  public function testEditFormLeadsWithContextAndHidesTargetsBehindChange(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, ['ticket_id' => $this->ticketT->id()]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    $summary = (string) $form['context']['summary']['#props']['text'];
    self::assertStringContainsString('Tue 06 Oct', $summary);
    self::assertStringContainsString('Customer G1 · PRJP', $summary);
    self::assertStringContainsString('Ticket T', $summary);
    self::assertSame('Recorded', (string) $form['context']['state']['#props']['label']);
    self::assertSame('details', $form['change']['#type']);
    self::assertFalse($form['change']['#open']);
    foreach (['work_date', 'project', 'ticket_wrapper'] as $name) {
      self::assertSame('change', $form[$name]['#group'] ?? NULL, $name);
    }
    foreach (['customer', 'state', 'record_another'] as $gone) {
      self::assertArrayNotHasKey($gone, $form);
    }
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $markup = (string) $this->container->get('renderer')->renderRoot($form);
    self::assertSame(1, preg_match('#<details[^>]*>(.*?)</details>#s', $markup, $group));
    self::assertStringContainsString('Change date, project or ticket', $group[1]);
    foreach (['name="work_date"', 'name="project"', 'name="ticket"'] as $field) {
      self::assertStringContainsString($field, $group[1], $field);
    }
    self::assertSame(1, substr_count($markup, 'name="work_date"'));
  }

  /**
   * A proposed entry's context carries the Proposed badge.
   */
  public function testProposedEntryShowsProposedBadge(): void {
    $this->actAs($this->employee);
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $entry = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-06',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'Proposed work',
      'project_id' => $this->projectP->id(),
      'state' => 'proposed',
      'submission_id' => $proposal->id(),
    ]);
    $entry->save();
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertSame('Proposed', (string) $form['context']['state']['#props']['label']);
  }

  /**
   * Record time asks project, ticket, date, duration, description, billing.
   */
  public function testAddFormFollowsTheQuestionsOrder(): void {
    $this->actAs($this->employee);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class);
    $order = ['project', 'ticket_wrapper', 'work_date', 'duration', 'description'];
    $weights = array_map(static fn (string $name): int => (int) ($form[$name]['#weight'] ?? 0), $order);
    $sorted = $weights;
    sort($sorted);
    self::assertSame($sorted, $weights);
    self::assertCount(count($order), array_unique($weights));
    self::assertArrayNotHasKey('change', $form);
    self::assertArrayNotHasKey('context', $form);
  }

  /**
   * The billing account is resolved and preselected; another may be chosen.
   */
  public function testBillingAccountResolvesAndMayBeChanged(): void {
    $this->actAs($this->employee);
    $assignments = $this->container->get('bb_track.assignments');
    $resolved = $assignments->resolveAccountId((int) $this->projectP->id(), NULL);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class);
    self::assertArrayNotHasKey('account', $form['ticket_wrapper']);
    $form_state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:00',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Auto-resolved',
    ]);
    self::assertSame([], $form_state->getErrors());
    $saved = Worklog::load(current($this->worklogIds()));
    self::assertEquals($resolved, $saved->get('account_id')->target_id);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $saved);
    self::assertSame([(string) $resolved], $form['ticket_wrapper']['account']['#default_value']);

    $admin = $this->createUser(['administer bakers'], 'billing-admin-p');
    assert($admin instanceof UserInterface);
    $this->actAs($admin);
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Billed apart',
      'project_id' => $this->projectP->id(),
      'workflow' => 'bb_feature',
    ]);
    $ticket->save();
    $other = $assignments->saveAccount((int) $this->projectP->id(), [
      'name' => 'Ticket work',
    ]);
    $this->actAs($this->employee);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $saved);
    self::assertCount(2, $form['ticket_wrapper']['account']['#picker_options']);
    $state = $this->submitEdit($saved, [
      'work_date' => '2026-10-06',
      'duration' => '1:00',
      'project' => [(string) $this->projectP->id()],
      'ticket' => [],
      'account' => [(string) $other->id()],
      'description' => 'Auto-resolved',
    ]);
    self::assertSame([], $state->getErrors());
    $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->resetCache();
    self::assertEquals($other->id(), Worklog::load($saved->id())->get('account_id')->target_id);
    $state = $this->submitEdit(Worklog::load($saved->id()), [
      'work_date' => '2026-10-06',
      'duration' => '1:00',
      'project' => [(string) $this->projectQ->id()],
      'ticket' => [],
      'account' => [(string) $other->id()],
      'description' => 'Wrong account for Q',
    ]);
    self::assertArrayHasKey('account', $state->getErrors());
  }

  /**
   * The billing account follows a project change, re-resolved against it.
   */
  public function testAccountFollowsTheMovedProject(): void {
    $this->actAs($this->employee);
    $entry = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-06',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'On P',
      'project_id' => $this->projectP->id(),
      'account_id' => $this->container->get('bb_track.assignments')->resolveAccountId((int) $this->projectP->id(), NULL),
    ]);
    $entry->save();
    $state = $this->submitEdit($entry, [
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => [(string) $this->projectQ->id()],
      'ticket' => [],
      'description' => 'Moved to Q',
    ]);
    self::assertSame([], $state->getErrors());
    $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->resetCache();
    $moved = Worklog::load($entry->id());
    self::assertEquals($this->projectQ->id(), $moved->get('project_id')->target_id);
    self::assertEquals($this->container->get('bb_track.assignments')->resolveAccountId((int) $this->projectQ->id(), NULL), $moved->get('account_id')->target_id);
  }

  /**
   * No configured account anywhere blocks the save with an actionable error.
   */
  public function testMissingAccountBlocksSaveWithActionableError(): void {
    $this->archiveAccounts($this->projectP);
    $this->actAs($this->employee);
    $before = $this->worklogIds();
    $form_state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:00',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'No account configured',
    ]);
    self::assertSame($before, $this->worklogIds());
    self::assertStringContainsString('No billing account is configured', (string) $form_state->getErrors()['project']);
  }

  /**
   * Delete is a separate danger action; Save stays the primary one.
   */
  public function testDeleteStandsApartAsDangerAction(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertArrayHasKey('submit', $form['actions']);
    self::assertArrayNotHasKey('delete', $form['actions']);
    self::assertSame('danger', $form['delete']['#props']['variant']);
    self::assertGreaterThan($form['actions']['#weight'] ?? 0, $form['delete']['#weight']);
  }

  /**
   * An unresolved ticket is removed by picking No ticket.
   */
  public function testUnresolvedTicketIsRemovedWithNoTicket(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, ['ticket_id' => $this->ticketT->id()]);
    $this->ticketT->delete();
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertArrayNotHasKey('clear_ticket', $form['ticket_wrapper']);
    $kept = $this->submitEdit($entry, ['duration' => '1:00', 'description' => 'Kept']);
    self::assertSame([], $kept->getErrors());
    self::assertNotNull(Worklog::load($entry->id())->get('ticket_id')->target_id);
    $entry = Worklog::load($entry->id());
    $removed = $this->submitEdit($entry, ['duration' => '1:00', 'description' => 'Removed', 'ticket' => []]);
    self::assertSame([], $removed->getErrors());
    $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->resetCache();
    self::assertNull(Worklog::load($entry->id())->get('ticket_id')->target_id);
  }

  /**
   * Record, edit and delete forms turn browser autocomplete off.
   */
  public function testTimeFormsTurnBrowserAutocompleteOff(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, ['duration_seconds' => 3600, 'description' => 'Row']);
    $builder = $this->container->get('form_builder');
    foreach ([
      $builder->getForm(WorklogForm::class),
      $builder->getForm(WorklogForm::class, $entry),
      $builder->getForm(WorklogDeleteForm::class, $entry),
    ] as $form) {
      self::assertSame('off', $form['#attributes']['autocomplete'] ?? NULL);
    }
  }

  /**
   * A recorded entry shows Recorded and does not claim it is approved.
   */
  public function testRecordedEntryShowsRecordedState(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Open row',
    ]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertSame('Recorded', (string) $form['context']['state']['#props']['label']);
    self::assertArrayNotHasKey('approved', $form);
  }

  /**
   * A POST that carries the GET form's version is rejected after another save.
   */
  public function testStalePostedEditConflicts(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 5400,
      'description' => 'First',
    ]);
    $form = $this->container->get('form_builder')->getForm(
      WorklogForm::class,
      $entry,
    );
    self::assertSame('hidden', $form['expected_version']['#type'] ?? NULL);
    $posted = (string) ($form['expected_version']['#default_value'] ?? '');
    self::assertSame($entry->version(), $posted);

    $this->submitEdit($entry, [
      'work_date' => '2026-10-06',
      'duration' => '2:00',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Second',
    ]);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache([$entry->id()]);
    $current = $storage->load($entry->id());
    self::assertInstanceOf(Worklog::class, $current);

    $form_state = new FormState();
    $form_state->setValues([
      'work_date' => '2026-10-08',
      'duration' => '3:00',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Stale',
      'expected_version' => $posted,
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm(
      WorklogForm::class,
      $form_state,
      $current,
    );
    $errors = array_map('strval', $form_state->getErrors());
    self::assertContains('This entry changed. Reload it before saving.', $errors);
    $storage->resetCache([$entry->id()]);
    $reloaded = $storage->load($entry->id());
    self::assertInstanceOf(Worklog::class, $reloaded);
    self::assertSame('Second', $reloaded->get('description')->value);
    self::assertSame(7200, (int) $reloaded->get('duration_seconds')->value);
  }

  /**
   * A delete POST that carries the GET form's version is rejected after a save.
   */
  public function testStalePostedDeleteConflicts(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Keep me',
    ]);
    $form = $this->container->get('form_builder')->getForm(
      WorklogDeleteForm::class,
      $entry,
    );
    self::assertSame('hidden', $form['expected_version']['#type'] ?? NULL);
    $posted = (string) ($form['expected_version']['#default_value'] ?? '');
    self::assertSame($entry->version(), $posted);

    $this->submitEdit($entry, [
      'work_date' => '2026-10-06',
      'duration' => '1:15',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Updated before delete',
    ]);

    $form_state = new FormState();
    $form_state->setValues([
      'expected_version' => $posted,
      'op' => 'Confirm',
    ]);
    $this->container->get('form_builder')->submitForm(
      WorklogDeleteForm::class,
      $form_state,
      $entry,
    );
    $messages = $this->container->get('messenger')->all();
    $errors = array_map('strval', $messages['error'] ?? []);
    self::assertContains('This entry changed. Reload it before saving.', $errors);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache([$entry->id()]);
    $reloaded = $storage->load($entry->id());
    self::assertInstanceOf(Worklog::class, $reloaded);
    self::assertSame('Updated before delete', $reloaded->get('description')->value);
  }

  /**
   * A peer cannot reach the owner's edit route.
   */
  public function testPeerIsDeniedOnOwnerEditRoute(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Secret',
    ]);
    $this->actAs($this->peer);
    $result = $this->container->get('access_manager')->checkNamedRoute(
      'bb_track.worklog.edit',
      [
        'bb_track_worklog' => $entry->uuid(),
      ],
      $this->peer,
      TRUE,
    );
    self::assertTrue($result->isForbidden());
  }

  /**
   * Anonymous users cannot add time.
   */
  public function testAnonymousCannotAdd(): void {
    $result = $this->container->get('access_manager')->checkNamedRoute(
      'bb_track.worklog.add',
      [],
      new AnonymousUserSession(),
      TRUE,
    );
    self::assertFalse($result->isAllowed());
  }

  /**
   * Project selection offers projects the actor can see and hides others.
   */
  public function testProjectSelectionHonorsReadScope(): void {
    $this->actAs($this->employee);
    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'bb_project',
        'handler' => 'bb_track_work_project',
      ]);
    self::assertInstanceOf(SelectionInterface::class, $handler);
    $ids = array_map('intval', array_keys($handler->getReferenceableEntities()['bb_project'] ?? []));
    self::assertContains((int) $this->projectP->id(), $ids);
    self::assertContains((int) $this->projectQ->id(), $ids);
    self::assertNotContains((int) $this->foreignProject->id(), $ids);
  }

  /**
   * Ticket selection lists only tickets of the selected project.
   */
  public function testTicketSelectionRequiresSelectedProject(): void {
    $this->actAs($this->employee);
    $empty = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'bb_ticket',
        'handler' => 'bb_track_work_ticket',
      ]);
    self::assertInstanceOf(SelectionInterface::class, $empty);
    self::assertSame([], $empty->getReferenceableEntities()['bb_ticket'] ?? []);

    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'bb_ticket',
        'handler' => 'bb_track_work_ticket',
        'bb_selected_project' => (int) $this->projectP->id(),
      ]);
    self::assertInstanceOf(SelectionInterface::class, $handler);
    $ids = array_map('intval', array_keys($handler->getReferenceableEntities()['bb_ticket'] ?? []));
    self::assertContains((int) $this->ticketT->id(), $ids);
    self::assertNotContains((int) $this->ticketQ->id(), $ids);
  }

  /**
   * Posted add-form input scopes the ticket picker to that project.
   */
  public function testAddFormReadsProjectFromUserInputForTicketScope(): void {
    $this->actAs($this->employee);
    $form_state = new FormState();
    $form_state->addBuildInfo('args', []);
    $form_state->setUserInput([
      'project' => $this->autocomplete($this->projectP),
    ]);
    $form_state->setMethod('POST');
    $form = $this->container->get('form_builder')->buildForm(
      WorklogForm::class,
      $form_state,
    );
    self::assertSame(['Ticket T'], array_column($form['ticket_wrapper']['ticket']['#picker_options'], 'label'));
  }

  /**
   * Add and delete forms opt out of island boost for a document POST.
   */
  public function testFormsOptOutOfIslandBoost(): void {
    $this->actAs($this->employee);
    $form_state = new FormState();
    $form_state->addBuildInfo('args', []);
    $form = $this->container->get('form_builder')->buildForm(
      WorklogForm::class,
      $form_state,
    );
    self::assertSame('false', $form['#attributes']['data-hx-boost'] ?? NULL);

    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 5400,
      'description' => 'Boost opt-out',
    ]);
    $delete_state = new FormState();
    $delete_state->addBuildInfo('args', [$entry]);
    $delete = $this->container->get('form_builder')->buildForm(
      WorklogDeleteForm::class,
      $delete_state,
    );
    self::assertSame('false', $delete['#attributes']['data-hx-boost'] ?? NULL);
  }

  /**
   * A rebuild for another project scopes and clears the edit form's ticket.
   */
  public function testEditFormPrefersPostedProjectOverStoredDefault(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Scope rebuild',
      'ticket_id' => $this->ticketT->id(),
    ]);
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$entry]);
    $form_state->setUserInput([
      'project' => $this->autocomplete($this->projectQ),
    ]);
    $form_state->setMethod('POST');
    $form_state->setRebuild();
    $form = $this->container->get('form_builder')->buildForm(
      WorklogForm::class,
      $form_state,
    );
    self::assertSame(['Ticket Q'], array_column($form['ticket_wrapper']['ticket']['#picker_options'], 'label'));
    self::assertSame([], $form['ticket_wrapper']['ticket']['#default_value']);
  }

  /**
   * Edit and delete GET forms render the digest as a hidden posted field.
   */
  public function testExpectedVersionIsPostedHiddenField(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Version in the form',
    ]);
    $edit = $this->container->get('form_builder')->getForm(
      WorklogForm::class,
      $entry,
    );
    self::assertSame('hidden', $edit['expected_version']['#type'] ?? NULL);
    self::assertSame($entry->version(), $edit['expected_version']['#default_value'] ?? NULL);

    $delete = $this->container->get('form_builder')->getForm(
      WorklogDeleteForm::class,
      $entry,
    );
    self::assertSame('hidden', $delete['expected_version']['#type'] ?? NULL);
    self::assertSame($entry->version(), $delete['expected_version']['#default_value'] ?? NULL);
  }

  /**
   * Duration uses the specified label and examples.
   */
  public function testDurationLabelAndExamples(): void {
    $this->actAs($this->employee);
    $form_state = new FormState();
    $form_state->addBuildInfo('args', []);
    $form = $this->container->get('form_builder')->buildForm(
      WorklogForm::class,
      $form_state,
    );
    self::assertSame('Duration (hours:minutes)', (string) $form['duration']['#title']);
    self::assertStringContainsString('0:30', (string) $form['duration']['#description']);
    self::assertStringContainsString('1:15', (string) $form['duration']['#description']);
  }

  /**
   * Customer and description values are escaped, not raw markup.
   */
  public function testCustomerAndDescriptionAreEscaped(): void {
    $this->actAs($this->employee);
    $group = $this->projectP->get('group_id')->entity;
    self::assertInstanceOf(BbGroupInterface::class, $group);
    $group->set('name', '<em>Evil</em> Corp');
    $group->save();
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => '<script>alert(1)</script>',
    ]);
    $form = $this->container->get('form_builder')->getForm(
      WorklogForm::class,
      $entry,
    );
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $rendered = (string) $this->container->get('renderer')->renderRoot($form['context']);
    self::assertStringContainsString('&lt;em&gt;Evil&lt;/em&gt; Corp', $rendered);
    self::assertStringNotContainsString('<em>Evil</em>', $rendered);
    self::assertSame('<script>alert(1)</script>', $form['description']['#default_value']);
    $form_state = new FormState();
    $form_state->setUserInput(['project' => [(string) $this->projectP->id()]]);
    $form_state->setMethod('POST');
    $add = $this->container->get('form_builder')->buildForm(WorklogForm::class, $form_state);
    $picker = (string) $this->container->get('renderer')->renderRoot($add['project']);
    self::assertStringContainsString('Evil', $picker, $picker);
    self::assertStringNotContainsString('<em>Evil</em>', $picker);
  }

  /**
   * A storage error keeps the submitted values and writes nothing new.
   */
  public function testStorageErrorRebuildsWithoutWriting(): void {
    $this->actAs($this->employee);
    \Drupal::state()->set('bb_track_test.fail_save', TRUE);
    try {
      $form_state = $this->submitAdd([
        'work_date' => '2026-10-06',
        'duration' => '1:30',
        'project' => $this->autocomplete($this->projectP),
        'description' => 'Should remain on the form',
      ]);
    }
    catch (EntityStorageException) {
      self::fail('The form must catch a storage error instead of letting it escape.');
    }
    finally {
      \Drupal::state()->set('bb_track_test.fail_save', FALSE);
    }
    self::assertTrue($form_state->isRebuilding());
    $messages = $this->container->get('messenger')->all();
    $errors = array_map('strval', $messages['error'] ?? []);
    self::assertNotSame([], $errors);
    self::assertSame([], $this->worklogIds());
  }

  /**
   * A guest in A who is lead in B cannot create a row against A's project.
   */
  public function testGuestLeadPostWritesNothing(): void {
    $guest = $this->createUser([
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ], 'guest-lead');
    self::assertInstanceOf(UserInterface::class, $guest);
    $this->addMembership($this->workspace, $guest, ['guest']);
    $this->addMembership($this->otherWorkspace, $guest, ['lead']);
    $this->actAs($guest);
    $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:00',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Forged from B rank',
    ]);
    self::assertSame([], $this->worklogIds());
  }

  /**
   * A dialog GET posts itself back through the island dialog format.
   */
  public function testAddDialogRequestAttachesHtmx(): void {
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', [
      '_wrapper_format' => 'island_dialog',
      'destination' => '/workspace-a/time?mode=day&date=2026-10-06',
    ]);
    $form_state = new FormState();
    $form_state->addBuildInfo('args', []);
    $form = $this->container->get('form_builder')->buildForm(
      WorklogForm::class,
      $form_state,
    );
    $post = (string) ($form['#attributes']['data-hx-post'] ?? '');
    self::assertStringContainsString('_wrapper_format=island_dialog', $post);
    $row = $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY] ?? $form['actions'] ?? [];
    $cancel = $row['cancel']['#url'] ?? NULL;
    self::assertInstanceOf(Url::class, $cancel);
    self::assertStringContainsString('/workspace-a/time', $cancel->toString());
    self::assertSame(
      'data-dialog-cancel',
      $row['cancel']['#attributes']['data-dialog-cancel'] ?? NULL,
      'island.dialog.js closes the hull from [data-dialog-cancel]; without it the X is a no-op.',
    );
  }

  /**
   * Dialog save returns to My time instead of the edit permalink.
   */
  public function testAddDialogSaveReturnsToOverview(): void {
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', [
      '_wrapper_format' => 'island_dialog',
      'destination' => '/workspace-a/time?mode=day&date=2026-10-06',
    ]);
    $form_state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:00',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Dialog save',
    ]);
    self::assertSame([], $form_state->getErrors());
    self::assertNotSame([], $this->worklogIds());
    $response = $form_state->getResponse();
    self::assertNotNull($response);
    $location = $response->headers->get('HX-Location') ?? '';
    self::assertStringContainsString('/workspace-a/time', $location);
  }

  /**
   * Delete from an overview-backed edit keeps the local destination.
   */
  public function testDeleteLinkCarriesLocalOverviewDestination(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Open from overview',
    ]);
    $destination = '/workspace-a/time?mode=day&date=2026-10-06&project=' . $this->projectP->id();
    $this->pushFormRequest('/time/' . $entry->uuid() . '/edit', [
      'destination' => $destination,
    ]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    [$path, $query] = $this->deleteHref($form);
    self::assertSame('/time/' . $entry->uuid() . '/delete', $path);
    self::assertSame($destination, $query['destination'] ?? NULL);
  }

  /**
   * A proposal review week stays the return target, submission included.
   */
  public function testSubmissionDestinationIsKept(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    $destination = '/workspace-a/time?mode=week&date=2026-10-05&submission=6b0f6a52-5e6d-4b9e-8f43-0c6a1f9d2a11';
    $this->pushFormRequest('/time/' . $entry->uuid() . '/edit', ['destination' => $destination]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertSame($destination, $this->deleteHref($form)[1]['destination'] ?? NULL);
  }

  /**
   * Canonical submission correction keeps its return path on cancel/delete.
   */
  public function testCanonicalSubmissionDestinationIsKept(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    $submission = Submission::create();
    $submission->save();
    $destination = '/time/submission/' . $submission->uuid();
    $this->pushFormRequest('/time/' . $entry->uuid() . '/edit', ['destination' => $destination]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertSame($destination, $this->deleteHref($form)[1]['destination'] ?? NULL);
    self::assertSame($destination, $form['actions']['cancel']['#url']->toString());
  }

  /**
   * Delete cancel returns to edit and keeps the overview destination.
   */
  public function testDeleteCancelKeepsEditAndOverviewDestination(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Cancel delete',
    ]);
    $destination = '/workspace-a/time?mode=week&date=2026-10-06';
    $this->pushFormRequest('/time/' . $entry->uuid() . '/delete', [
      'destination' => $destination,
    ]);
    $form = $this->container->get('form_builder')->getForm(WorklogDeleteForm::class, $entry);
    $cancel = $form['actions']['cancel']['#url'] ?? NULL;
    self::assertInstanceOf(Url::class, $cancel);
    self::assertSame('bb_track.worklog.edit', $cancel->getRouteName());
    self::assertSame($entry->uuid(), $cancel->getRouteParameters()['bb_track_worklog']);
    self::assertSame($destination, $cancel->getOption('query')['destination'] ?? NULL);
  }

  /**
   * External and non-overview destinations are not copied onto Delete.
   */
  public function testHostileDestinationIsNotCopiedOntoDelete(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'duration_seconds' => 3600,
      'description' => 'Hostile destination',
    ]);
    foreach ([
      'https://evil.example/time',
      '//evil.example/time',
      '/logout',
      '/time/add',
      '/time',
      '/user/time',
    ] as $hostile) {
      $this->pushFormRequest('/time/' . $entry->uuid() . '/edit', [
        'destination' => $hostile,
      ]);
      $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
      self::assertSame([], $this->deleteHref($form)[1], $hostile);
    }
  }

  /**
   * Caller context preselects date, project and ticket the employee may use.
   */
  public function testPrefillAppliesPermittedContext(): void {
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', [
      'date' => '2026-08-04',
      'project' => (string) $this->projectP->id(),
      'ticket' => (string) $this->ticketT->id(),
    ]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class);
    self::assertSame('2026-08-04', $form['work_date']['#default_value']);
    self::assertSame([(string) $this->projectP->id()], $form['project']['#default_value']);
    self::assertSame([(string) $this->ticketT->id()], $form['ticket_wrapper']['ticket']['#default_value']);
    self::assertSame('Customer G1 · PRJP', $form['project']['#picker_options'][(string) $this->projectP->id()]['label']);
  }

  /**
   * The ticket pill searches the selected project's tickets on the server.
   */
  public function testTicketPickerSearchesOnTheServer(): void {
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', ['project' => (string) $this->projectP->id()]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class);
    $element = $form['ticket_wrapper']['ticket'] + ['#name' => 'ticket', '#id' => 'edit-ticket', '#value' => []];
    $props = WorklogFormLayout::renderPicker($element)['control']['#props'];
    self::assertSame('/time/options/ticket?project=' . $this->projectP->id(), $props['search_url']);
    self::assertTrue($props['fallback']);
    self::assertTrue($props['searchable']);
    $this->container->get('request_stack')->getCurrentRequest()->headers->set('X-Requested-With', 'XMLHttpRequest');
    self::assertFalse(WorklogFormLayout::renderPicker($element)['control']['#props']['fallback']);
  }

  /**
   * Caller context the employee may not use is dropped with a notice.
   */
  public function testPrefillIsRevalidated(): void {
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', [
      'date' => '2026-08-04',
      'project' => (string) $this->foreignProject->id(),
      'ticket' => (string) $this->ticketQ->id(),
    ]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class);
    self::assertSame('2026-08-04', $form['work_date']['#default_value']);
    self::assertSame([], $form['project']['#default_value']);
    self::assertSame([], $form['ticket_wrapper']['ticket']['#default_value']);
    $warnings = array_map('strval', $this->container->get('messenger')->all()['warning'] ?? []);
    self::assertContains('The suggested project is not available.', $warnings);
    self::assertContains('The suggested ticket is not available.', $warnings);
  }

  /**
   * A ticket of another project in the context is dropped as well.
   */
  public function testPrefillDropsTicketOfAnotherProject(): void {
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', [
      'project' => (string) $this->projectP->id(),
      'ticket' => (string) $this->ticketQ->id(),
    ]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class);
    self::assertSame([(string) $this->projectP->id()], $form['project']['#default_value']);
    self::assertSame([], $form['ticket_wrapper']['ticket']['#default_value']);
  }

  /**
   * Caller context never changes the stored values of an existing entry.
   */
  public function testPrefillNeverTouchesAnExistingEntry(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, ['work_date' => '2026-08-03']);
    $this->pushFormRequest('/time/' . $entry->uuid() . '/edit', [
      'project' => (string) $this->projectQ->id(),
      'date' => '2026-01-01',
    ]);
    $form = $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
    self::assertSame('2026-08-03', $form['work_date']['#default_value']);
    self::assertSame([(string) $this->projectP->id()], $form['project']['#default_value']);
  }

  /**
   * Posting the same add form twice stores one entry.
   */
  public function testReplayedCreateIsIdempotent(): void {
    $this->actAs($this->employee);
    $values = [
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => (string) $this->projectP->id(),
      'description' => 'Review changes',
      'entry_uuid' => '2f1c7a52-1b0a-4f43-9a8a-1f2d3c4b5a69',
    ];
    self::assertSame([], $this->submitAdd($values)->getErrors());
    self::assertSame([], $this->submitAdd($values)->getErrors());
    self::assertCount(1, $this->worklogIds());
  }

  /**
   * Another employee's entry UUID cannot be claimed by a forged add form.
   */
  public function testForeignEntryUuidIsRejected(): void {
    $foreign = $this->createRecorded($this->peer, ['description' => 'Peer work']);
    $this->actAs($this->employee);
    $state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => (string) $this->projectP->id(),
      'description' => 'Forged',
      'entry_uuid' => $foreign->uuid(),
    ]);
    self::assertNotSame([], $state->getErrors());
    self::assertCount(1, $this->worklogIds());
    self::assertSame('Peer work', Worklog::load($foreign->id())->get('description')->value);
  }

  /**
   * A ticket of another project is rejected while the input stays.
   */
  public function testTicketOfAnotherProjectIsRejectedAndExplained(): void {
    $this->actAs($this->employee);
    $state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => (string) $this->projectP->id(),
      'ticket' => (string) $this->ticketQ->id(),
      'description' => 'Review changes',
    ]);
    self::assertArrayHasKey('ticket', $state->getErrors());
    self::assertSame('Review changes', $state->getValue('description'));
    self::assertSame([], $this->worklogIds());
  }

  /**
   * A rebuild for a new project clears the previous ticket and says so.
   */
  public function testProjectChangeClearsTicketWithNotice(): void {
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', [
      'project' => (string) $this->projectP->id(),
      'ticket' => (string) $this->ticketT->id(),
    ]);
    $form_state = new FormState();
    $form_state->addBuildInfo('args', []);
    $form_state->setUserInput([
      'project' => (string) $this->projectQ->id(),
      'ticket' => (string) $this->ticketT->id(),
    ]);
    $form_state->setMethod('POST');
    $form_state->setRebuild();
    $form = $this->container->get('form_builder')->buildForm(WorklogForm::class, $form_state);
    self::assertSame([], $form['ticket_wrapper']['ticket']['#default_value']);
    self::assertStringContainsString('Ticket cleared: it does not belong to PRJQ.', (string) $form['ticket_wrapper']['ticket_cleared']['#markup']);
  }

  /**
   * A submission context adds the new row to the employee's own proposal.
   */
  public function testSubmissionContextCreatesProposedRow(): void {
    $this->actAs($this->employee);
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $this->pushFormRequest('/time/add', ['submission' => $proposal->uuid()]);
    $state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => (string) $this->projectP->id(),
      'description' => 'Proposed work',
    ]);
    self::assertSame([], $state->getErrors());
    $row = Worklog::load(current($this->worklogIds()));
    self::assertSame('proposed', $row->get('state')->value);
    self::assertSame((string) $proposal->id(), (string) $row->get('submission_id')->target_id);
  }

  /**
   * A foreign submission in the context is ignored.
   */
  public function testForeignSubmissionContextIsIgnored(): void {
    $this->actAs($this->peer);
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $this->actAs($this->employee);
    $this->pushFormRequest('/time/add', ['submission' => $proposal->uuid()]);
    $state = $this->submitAdd([
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => (string) $this->projectP->id(),
      'description' => 'Own work',
    ]);
    self::assertSame([], $state->getErrors());
    $row = Worklog::load(current($this->worklogIds()));
    self::assertSame('recorded', $row->get('state')->value);
    self::assertTrue($row->get('submission_id')->isEmpty());
  }

  /**
   * Submits the add form.
   *
   * @param array<string, mixed> $values
   *   Submitted values.
   */
  private function submitAdd(array $values): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues($values + ['op' => 'Save']);
    $this->container->get('form_builder')->submitForm(
      WorklogForm::class,
      $form_state,
    );
    return $form_state;
  }

  /**
   * Path and query of the edit form's Delete action.
   *
   * @return array{0: string, 1: array<mixed>}
   *   Path and parsed query.
   */
  private function deleteHref(array $form): array {
    $href = (string) $form['delete']['#props']['href'];
    parse_str((string) parse_url($href, PHP_URL_QUERY), $query);
    return [(string) parse_url($href, PHP_URL_PATH), $query];
  }

  /**
   * Submits the edit form.
   *
   * @param \Drupal\bb_track\Entity\Worklog $entry
   *   The row being edited.
   * @param array<string, mixed> $values
   *   Submitted values.
   */
  private function submitEdit(Worklog $entry, array $values): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues($values + [
      'expected_version' => $entry->version(),
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm(
      WorklogForm::class,
      $form_state,
      $entry,
    );
    return $form_state;
  }

  /**
   * Submits the delete confirmation.
   */
  private function submitDelete(Worklog $entry): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues([
      'expected_version' => $entry->version(),
      'op' => 'Confirm',
    ]);
    $this->container->get('form_builder')->submitForm(
      WorklogDeleteForm::class,
      $form_state,
      $entry,
    );
    return $form_state;
  }

  /**
   * Formats an entity as Drupal autocomplete input.
   */
  private function autocomplete(object $entity): string {
    self::assertTrue(method_exists($entity, 'label') && method_exists($entity, 'id'));
    return $entity->label() . ' (' . $entity->id() . ')';
  }

  /**
   * Stored worklog ids without access checks.
   *
   * @return array<int>
   *   Entity ids.
   */
  private function worklogIds(): array {
    return array_map('intval', array_values(
      $this->container->get('entity_type.manager')
        ->getStorage('bb_track_worklog')
        ->getQuery()
        ->accessCheck(FALSE)
        ->execute(),
    ));
  }

  /**
   * Creates a recorded row.
   *
   * @param \Drupal\user\UserInterface $owner
   *   Row owner.
   * @param array<string, mixed> $values
   *   Field overrides.
   */
  private function createRecorded(UserInterface $owner, array $values = []): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => $owner->id(),
      'work_date' => $values['work_date'] ?? '2026-10-06',
      'timezone' => $values['timezone'] ?? 'UTC',
      'duration_seconds' => $values['duration_seconds'] ?? 5400,
      'description' => $values['description'] ?? 'Review changes',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $values['project_id'] ?? $this->projectP->id(),
      'ticket_id' => $values['ticket_id'] ?? NULL,
    ]);
    LegacyWorklogFixture::save($entry);
    self::assertInstanceOf(Worklog::class, $entry);
    return $entry;
  }

  /**
   * Creates an approved row.
   */
  private function createApproved(): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-06',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'Locked work',
      'derivation' => 'manual',
      'state' => 'approved',
      'project_id' => $this->projectP->id(),
    ]);
    LegacyWorklogFixture::save($entry);
    self::assertInstanceOf(Worklog::class, $entry);
    return $entry;
  }

  /**
   * Makes an account the current user.
   */
  private function actAs(UserInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * Pushes a form request, including an optional destination.
   *
   * @param string $path
   *   Request path.
   * @param array<string, string> $query
   *   Query arguments.
   */
  private function pushFormRequest(string $path, array $query = []): void {
    $request = Request::create($path, 'GET', $query);
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    else {
      $request->setSession(new Session(new MockArraySessionStorage()));
    }
    $this->container->get('request_stack')->push($request);
  }

  /**
   * Creates a group in a workspace.
   */
  private function createGroup(string $name, BbWorkspaceInterface $workspace): BbGroupInterface {
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create([
        'name' => $name,
        'workspace_id' => $workspace->id(),
        'owner_user_id' => $this->worldOwner->id(),
      ]);
    $group->save();
    self::assertInstanceOf(BbGroupInterface::class, $group);
    return $group;
  }

  /**
   * Creates a project in a group.
   */
  private function createProject(string $key, BbGroupInterface $group): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => $key,
        'key' => $key,
        'owner_user_id' => $this->worldOwner->id(),
        'group_id' => $group->id(),
      ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->attachBillingAccount($project);
    return $project;
  }

  /**
   * Creates a ticket on a project.
   */
  private function createTicket(string $title, BbProjectInterface $project): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'project_id' => $project->id(),
        'workflow' => 'bb_feature',
      ]);
    $ticket->save();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Loads the shipped overview View so destination routes resolve.
   */
  private function installShippedOverviewView(): void {
    $path = dirname(__DIR__, 7) . '/recipes/bakers/config/views.view.worklog.yml';
    self::assertFileExists($path);
    $data = Yaml::parseFile($path);
    self::assertIsArray($data);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
  }

  /**
   * Registers the My work page so Cancel links resolve.
   */
  private function installMinimalMyWorkView(): void {
    $this->container->get('entity_type.manager')->getStorage('view')->create([
      'id' => 'tickets',
      'base_table' => 'users_field_data',
      'display' => [
        'default' => [
          'display_plugin' => 'default',
          'id' => 'default',
          'display_title' => 'Default',
          'position' => 0,
          'display_options' => [],
        ],
        'my_work' => [
          'display_plugin' => 'page',
          'id' => 'my_work',
          'display_title' => 'My work',
          'position' => 1,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/tickets',
          ],
        ],
      ],
    ])->save();
  }

}
