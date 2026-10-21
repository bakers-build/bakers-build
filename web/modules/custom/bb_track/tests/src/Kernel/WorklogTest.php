<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Form\WorklogDeleteForm;
use Drupal\bb_track\Form\WorklogForm;
use Drupal\bb_track\Form\WorklogFormLayout;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Storage, mutation and validation for manual Worklog.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogTest extends KernelTestBase {

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
    'island',
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
   * Second workspace used for cross-tenant rejection.
   */
  private BbWorkspaceInterface $otherWorkspace;

  /**
   * Customer group G1 on the original project.
   */
  private BbGroupInterface $groupG1;

  /**
   * Customer group G2 used when regrouping project P.
   */
  private BbGroupInterface $groupG2;

  /**
   * Customer group G3 on project Q.
   */
  private BbGroupInterface $groupG3;

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
    $this->installOgScopeFixture();

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

    $this->groupG1 = $this->createGroup('Customer G1', $this->workspace);
    $this->groupG2 = $this->createGroup('Customer G2', $this->workspace);
    $this->groupG3 = $this->createGroup('Customer G3', $this->workspace);
    $foreign_group = $this->createGroup('Foreign customer', $this->otherWorkspace);

    $this->projectP = $this->createProject('PRJP', $this->groupG1);
    $this->projectQ = $this->createProject('PRJQ', $this->groupG3);
    $this->foreignProject = $this->createProject('PRJF', $foreign_group);

    $this->ticketT = $this->createTicket('Ticket T', $this->projectP);
    $this->ticketQ = $this->createTicket('Ticket Q', $this->projectQ);

    $this->addMembership($this->workspace, $this->employee, ['lead']);
    $this->addMembership($this->workspace, $this->peer, ['lead']);
  }

  /**
   * Saving a valid entry persists canonical fields.
   */
  public function testAddPersistsCanonicalValues(): void {
    $this->actAs($this->employee);
    $form_state = $this->submitAdd($this->validForm());
    self::assertSame([], $form_state->getErrors());
    $ids = $this->worklogIds();
    self::assertCount(1, $ids);
    $saved = Worklog::load(reset($ids));
    self::assertInstanceOf(Worklog::class, $saved);
    self::assertSame((int) $this->projectP->id(), (int) $saved->get('project_id')->target_id);
    $form = $this->form($saved);
    self::assertStringContainsString('Customer G1', (string) $form['context']['summary']['#props']['text']);
    self::assertSame(5400, (int) $saved->get('duration_seconds')->value);
    self::assertSame('2026-10-06', $saved->get('work_date')->value);
    self::assertSame('manual', $saved->get('derivation')->value);
    self::assertSame('recorded', $saved->get('state')->value);
    self::assertSame((int) $this->employee->id(), (int) $saved->get('owner_user_id')->target_id);
    self::assertSame('Europe/Berlin', $saved->get('timezone')->value);
    self::assertSame('Review changes', $saved->get('description')->value);
    self::assertTrue($saved->get('ticket_id')->isEmpty());
  }

  /**
   * Duration strings convert by integer arithmetic, or they are rejected.
   */
  public function testDurationConversionCases(): void {
    $this->actAs($this->employee);
    $valid = [
      '0:01' => 60,
      '1:30' => 5400,
      ' 2:15 ' => 8100,
      '24:00' => 86400,
    ];
    foreach ($valid as $input => $seconds) {
      $form_state = $this->submitAdd($this->validForm(['duration' => $input]));
      self::assertSame([], $form_state->getErrors(), $input);
      $ids = $this->worklogIds();
      $entry = Worklog::load(end($ids));
      self::assertInstanceOf(Worklog::class, $entry);
      self::assertSame($seconds, (int) $entry->get('duration_seconds')->value, $input);
      $entry->delete();
    }

    foreach ([
      '0:00',
      '-1:00',
      '1:60',
      '1.5',
      '1e3',
      '1:5',
      ':30',
      '1:30:00',
      '24:01',
      '1000000:00',
      '',
      '   ',
    ] as $invalid) {
      $this->assertFormError('duration', $this->validForm(['duration' => $invalid]));
    }
  }

  /**
   * Missing, empty, overlong and impossible values are rejected with paths.
   */
  public function testInvalidDatesDescriptionsAndAssignments(): void {
    $this->actAs($this->employee);
    $this->assertFormError('work_date', $this->validForm(['work_date' => '2026-02-30']));
    $this->assertFormError('work_date', $this->validForm(['work_date' => '2026-13-01']));
    $this->assertFormError('work_date', $this->validForm(['work_date' => '26-10-06']));
    $this->assertFormError('work_date', $this->validForm(['work_date' => '']));
    $this->assertFormError('description', $this->validForm(['description' => '   ']));
    $this->assertFormError('description', $this->validForm([
      'description' => str_repeat('a', 2001),
    ]));
    $this->assertFormError('project', $this->validForm(['project' => '']));
    $this->assertFormError('ticket', $this->validForm([
      'ticket' => $this->autocomplete($this->ticketQ),
    ]));
  }

  /**
   * A worklog cannot be created without a billing account.
   *
   * The required field is always backed by the shared resolver, never a
   * blank write.
   */
  public function testAccountIsRequiredAndResolvedAutomatically(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    self::assertNotEmpty($entry->get('account_id')->target_id);
    $assignments = $this->container->get('bb_track.assignments');
    self::assertEquals($assignments->resolveAccountId((int) $this->projectP->id(), NULL), $entry->get('account_id')->target_id);

    $this->archiveAccounts($this->projectP);
    $blocked = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-07',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'No account configured',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $this->projectP->id(),
    ]);
    $this->expectException(\DomainException::class);
    $this->expectExceptionMessage('No billing account is configured for this project or ticket. Ask a project maintainer to set one.');
    $blocked->save();
  }

  /**
   * A new ticket on an unchanged project still requires a visible project.
   */
  public function testNewTicketRequiresCurrentProjectScope(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    $foreign_group = $this->foreignProject->get('group_id')->entity;
    self::assertInstanceOf(BbGroupInterface::class, $foreign_group);
    $this->projectP->set('group_id', $foreign_group->id());
    $this->projectP->save();
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $form_state = $this->submitEdit($entry, [
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'ticket' => $this->autocomplete($this->ticketT),
      'description' => 'Review changes',
    ]);
    self::assertNotSame([], $form_state->getErrors());
    self::assertTrue(
      isset($form_state->getErrors()['ticket']) || isset($form_state->getErrors()['project']),
      implode(', ', array_keys($form_state->getErrors())),
    );
  }

  /**
   * Posted owner, state and timezone values cannot be set from the form.
   */
  public function testPrivilegedKeysAreIgnored(): void {
    $this->actAs($this->employee);
    $form_state = $this->submitAdd($this->validForm([
      'owner_user_id' => $this->peer->id(),
      'employee_id' => $this->peer->id(),
      'state' => 'approved',
      'derivation' => 'forged',
      'timezone' => 'America/New_York',
      'workspace_id' => 99,
      'group_uuid' => 'forged',
      'extra' => 'forged',
    ]));
    self::assertSame([], $form_state->getErrors());
    $ids = $this->worklogIds();
    self::assertCount(1, $ids);
    $saved = Worklog::load(reset($ids));
    self::assertInstanceOf(Worklog::class, $saved);
    self::assertSame((int) $this->employee->id(), (int) $saved->get('owner_user_id')->target_id);
    self::assertSame('recorded', $saved->get('state')->value);
    self::assertSame('manual', $saved->get('derivation')->value);
    self::assertSame('Europe/Berlin', $saved->get('timezone')->value);
  }

  /**
   * Customer follows the project's current group, including after regrouping.
   */
  public function testCustomerFollowsLiveProjectGroup(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    $form = $this->form($entry);
    self::assertStringContainsString('Customer G1', (string) $form['context']['summary']['#props']['text']);
    $this->projectP->set('group_id', $this->groupG2->id())->save();
    $this->reload($entry);
    $form = $this->form($entry);
    self::assertStringContainsString('Customer G2', (string) $form['context']['summary']['#props']['text']);
    $this->submitEdit($entry, $this->validForm(['description' => 'Corrected notes']));
    $this->reload($entry);
    self::assertSame('Corrected notes', $entry->get('description')->value);
    $form = $this->form($entry);
    self::assertStringContainsString('Customer G2', (string) $form['context']['summary']['#props']['text']);
  }

  /**
   * Reassigning the entry to project Q shows Q's group.
   */
  public function testReassignmentShowsNewGroup(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    $this->submitEdit($entry, $this->validForm([
      'project' => $this->autocomplete($this->projectQ),
      'duration' => '2:15',
    ]));
    $this->reload($entry);
    self::assertSame((int) $this->projectQ->id(), (int) $entry->get('project_id')->target_id);
    self::assertSame(8100, (int) $entry->get('duration_seconds')->value);
    $form = $this->form($entry);
    self::assertStringContainsString('Customer G3', (string) $form['context']['summary']['#props']['text']);
  }

  /**
   * New assignments without a group, or from another workspace, fail.
   */
  public function testMissingGroupAndCrossWorkspaceRejected(): void {
    $this->actAs($this->employee);
    $orphan = $this->createProject('ORPH', NULL);
    $this->assertFormError('project', $this->validForm([
      'project' => $this->autocomplete($orphan),
    ]));
    $this->assertFormError('project', $this->validForm([
      'project' => $this->autocomplete($this->foreignProject),
    ]));
    self::assertSame([], $this->worklogIds());
  }

  /**
   * Deleting targets keeps stored ids and duration on the worklog.
   */
  public function testDeletedTargetsRetainStoredUuids(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'ticket_id' => $this->ticketT->id(),
    ]);
    $project_id = (int) $this->projectP->id();
    $ticket_id = (int) $this->ticketT->id();
    $this->ticketT->delete();
    $this->projectP->delete();
    $this->groupG1->delete();
    $this->reload($entry);
    self::assertSame($project_id, (int) $entry->get('project_id')->target_id);
    self::assertSame($ticket_id, (int) $entry->get('ticket_id')->target_id);
    self::assertSame(5400, (int) $entry->get('duration_seconds')->value);

    $form = $this->form($entry);
    self::assertStringContainsString('Unresolved customer', (string) $form['context']['summary']['#props']['text']);
    self::assertArrayHasKey('project_unresolved', $form);
    self::assertArrayHasKey('ticket_unresolved', $form['ticket_wrapper']);
    self::assertSame([], $form['project']['#default_value']);
    self::assertSame([WorklogFormLayout::RETAINED], $form['ticket_wrapper']['ticket']['#default_value']);

    $form_state = $this->submitEdit($entry, [
      'work_date' => '2026-10-06',
      'duration' => '0:45',
      'description' => 'Kept unresolved project',
    ]);
    self::assertSame([], $form_state->getErrors());
    $this->reload($entry);
    self::assertSame($project_id, (int) $entry->get('project_id')->target_id);
    self::assertSame(2700, (int) $entry->get('duration_seconds')->value);
  }

  /**
   * Deleting an entry leaves targets and a peer's row intact.
   */
  public function testDeleteLeavesTargetsAndPeers(): void {
    $this->actAs($this->employee);
    $mine = $this->createRecorded($this->employee);
    $peer = $this->createRecorded($this->peer, ['description' => 'Peer notes']);
    $this->submitDelete($mine);
    self::assertNull($this->container->get('entity_type.manager')
      ->getStorage('bb_track_worklog')
      ->load($mine->id()));
    self::assertInstanceOf(BbProjectInterface::class, $this->container
      ->get('entity_type.manager')
      ->getStorage('bb_project')
      ->load($this->projectP->id()));
    $this->reload($peer);
    self::assertSame('Peer notes', $peer->get('description')->value);
  }

  /**
   * A storage error during save leaves the persisted row unchanged.
   */
  public function testForcedSaveFailureLeavesStorageUnchanged(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    \Drupal::state()->set('bb_track_test.fail_save', TRUE);
    $form_state = $this->submitEdit($entry, $this->validForm([
      'description' => 'Should not persist',
    ]));
    \Drupal::state()->set('bb_track_test.fail_save', FALSE);
    self::assertTrue($form_state->isRebuilding());
    $this->reload($entry);
    self::assertSame('Review changes', $entry->get('description')->value);
  }

  /**
   * A stale posted version is rejected without overwriting the first save.
   */
  public function testStaleEditRejected(): void {
    $this->actAs($this->employee);
    $first = $this->createRecorded($this->employee);
    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_track_worklog')->loadUnchanged($first->id());
    self::assertInstanceOf(Worklog::class, $fresh);
    self::assertSame($first->version(), $fresh->version());
    $form = $this->container->get('form_builder')->getForm(
      WorklogForm::class,
      $first,
    );
    $posted = (string) ($form['expected_version']['#default_value'] ?? '');
    $this->submitEdit($first, $this->validForm(['description' => 'First editor']));
    $form_state = new FormState();
    $form_state->setValues($this->validForm(['description' => 'Stale editor']) + [
      'expected_version' => $posted,
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm(
      WorklogForm::class,
      $form_state,
      $first,
    );
    $errors = array_map('strval', $form_state->getErrors());
    self::assertContains('This entry changed. Reload it before saving.', $errors);
    $this->reload($first);
    self::assertSame('First editor', $first->get('description')->value);
  }

  /**
   * An approved fixture cannot be updated through the form.
   */
  public function testApprovedFixtureRejectsUpdate(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'description' => 'Already approved',
      'state' => 'approved',
      'duration_seconds' => 3600,
    ]);
    $form_state = $this->submitEdit($entry, $this->validForm([
      'description' => 'should fail',
    ]));
    self::assertNotSame([], $form_state->getErrors());
    $this->reload($entry);
    self::assertSame('Already approved', $entry->get('description')->value);
  }

  /**
   * Approved worklog also refuses delete.
   */
  public function testApprovedFixtureRejectsDelete(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee, [
      'description' => 'Already approved',
      'state' => 'approved',
      'duration_seconds' => 3600,
    ]);
    $this->submitDelete($entry);
    self::assertInstanceOf(Worklog::class, $this->container
      ->get('entity_type.manager')
      ->getStorage('bb_track_worklog')
      ->load($entry->id()));
  }

  /**
   * Changing the employee timezone does not shift a stored work date.
   */
  public function testTimezoneSnapshotStable(): void {
    $this->actAs($this->employee);
    $this->submitAdd($this->validForm(['work_date' => '2026-10-25']));
    $ids = $this->worklogIds();
    $entry = Worklog::load(reset($ids));
    self::assertInstanceOf(Worklog::class, $entry);
    self::assertSame('Europe/Berlin', $entry->get('timezone')->value);
    $this->employee->set('timezone', 'America/New_York')->save();
    $this->submitEdit($entry, $this->validForm([
      'work_date' => '2026-10-26',
      'description' => 'Next day',
    ]));
    $this->reload($entry);
    self::assertSame('2026-10-26', $entry->get('work_date')->value);
    self::assertSame('Europe/Berlin', $entry->get('timezone')->value);
  }

  /**
   * The edit form shows visible project, ticket and customer, or unresolved.
   */
  public function testEditFormShowsVisibleTargets(): void {
    $this->actAs($this->employee);
    $with_ticket = $this->createRecorded($this->employee, [
      'ticket_id' => $this->ticketT->id(),
    ]);
    $form = $this->form($with_ticket);
    self::assertSame([(string) $this->projectP->id()], $form['project']['#default_value']);
    self::assertSame([(string) $this->ticketT->id()], $form['ticket_wrapper']['ticket']['#default_value']);
    self::assertStringContainsString('Customer G1', (string) $form['context']['summary']['#props']['text']);
    self::assertArrayNotHasKey('project_unresolved', $form);
    self::assertArrayNotHasKey('ticket_unresolved', $form['ticket_wrapper']);

    $without = $this->createRecorded($this->employee, ['description' => 'No ticket']);
    $form = $this->form($without);
    self::assertSame([], $form['ticket_wrapper']['ticket']['#default_value']);
    self::assertArrayNotHasKey('ticket_unresolved', $form['ticket_wrapper']);
  }

  /**
   * A peer cannot update or delete another employee's entry.
   */
  public function testPeerCannotMutate(): void {
    $this->actAs($this->employee);
    $entry = $this->createRecorded($this->employee);
    $this->actAs($this->peer);
    $edit = $this->submitEdit($entry, $this->validForm(['description' => 'Hijack']));
    self::assertNotSame([], $edit->getErrors());
    $this->submitDelete($entry);
    $this->reload($entry);
    self::assertSame('Review changes', $entry->get('description')->value);
  }

  /**
   * Default valid add/edit values, with overrides merged on top.
   *
   * @param array<string, mixed> $overrides
   *   Form values to replace.
   *
   * @return array<string, mixed>
   *   Form values.
   */
  private function validForm(array $overrides = []): array {
    return $overrides + [
      'work_date' => '2026-10-06',
      'duration' => '1:30',
      'project' => $this->autocomplete($this->projectP),
      'description' => 'Review changes',
    ];
  }

  /**
   * Asserts the add form reports an error on a field.
   *
   * @param string $field
   *   Form element name.
   * @param array<string, mixed> $values
   *   Form values.
   */
  private function assertFormError(string $field, array $values): void {
    $form_state = $this->submitAdd($values);
    self::assertArrayHasKey($field, $form_state->getErrors(), implode(', ', array_keys($form_state->getErrors())));
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
      'state' => $values['state'] ?? 'recorded',
      'project_id' => $values['project_id'] ?? $this->projectP->id(),
      'ticket_id' => $values['ticket_id'] ?? NULL,
    ]);
    LegacyWorklogFixture::save($entry);
    self::assertInstanceOf(Worklog::class, $entry);
    return $entry;
  }

  /**
   * Formats an entity as Drupal autocomplete input.
   */
  private function autocomplete(object $entity): string {
    self::assertTrue(method_exists($entity, 'label') && method_exists($entity, 'id'));
    return $entity->label() . ' (' . $entity->id() . ')';
  }

  /**
   * Reloads a worklog entity from storage.
   */
  private function reload(Worklog $entry): void {
    $storage = $this->container->get('entity_type.manager')
      ->getStorage('bb_track_worklog');
    $storage->resetCache([$entry->id()]);
    $reloaded = $storage->load($entry->id());
    self::assertInstanceOf(Worklog::class, $reloaded);
    foreach ($reloaded->getFields() as $name => $items) {
      $entry->set($name, $items->getValue());
    }
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
   * Makes an account the current user.
   */
  private function actAs(UserInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * Builds the native edit form for an entry.
   *
   * @return array<string, mixed>
   *   The form.
   */
  private function form(Worklog $entry): array {
    return $this->container->get('form_builder')->getForm(WorklogForm::class, $entry);
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
   * Creates a project in an optional group.
   */
  private function createProject(string $key, ?BbGroupInterface $group): BbProjectInterface {
    $values = [
      'name' => $key,
      'key' => $key,
      'owner_user_id' => $this->worldOwner->id(),
    ];
    if ($group !== NULL) {
      $values['group_id'] = $group->id();
    }
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create($values);
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

}
