<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Database\Database;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WorkAssignments;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * One default per project, one link per ticket; resolution walks ancestry.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class AccountTest extends WorkTimeTestBase {

  /**
   * Access-checked collections follow project visibility for every actor.
   */
  public function testQueryAccess(): void {
    $types = $this->container->get('entity_type.manager');
    $project = $types->getStorage('bb_project')->create([
      'name' => 'Lead only',
      'key' => 'LEAD',
      'group_id' => $this->project->get('group_id')->target_id,
      'owner_user_id' => $this->project->get('owner_user_id')->target_id,
    ]);
    $project->save();
    $default = $this->assignments()->defaultAccount((int) $project->id());
    $other = $this->assignments()->saveAccount((int) $project->id(), [
      'name' => 'Lead account',
    ], $default ? (int) $default->id() : NULL);
    $storage = $types->getStorage('bb_track_account');
    self::assertEqualsCanonicalizing([$this->accountId, $other->id()], array_values($storage->getQuery()->accessCheck(TRUE)->execute()));
    $this->container->get('current_user')->setAccount($this->peer);
    self::assertEquals([$this->accountId], array_values($storage->getQuery()->accessCheck(TRUE)->execute()));
    $outsider = $this->createUser(['view bb_project'], 'outsider');
    assert($outsider instanceof UserInterface);
    $this->container->get('current_user')->setAccount($outsider);
    self::assertSame([], $storage->getQuery()->accessCheck(TRUE)->execute());
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    self::assertSame([], $storage->getQuery()->accessCheck(TRUE)->execute());
  }

  /**
   * Account reads come from the database, never from a stale cached copy.
   *
   * A render racing a locked write could cache the old row; the next write
   * under the lock would then decide on, and save back, outdated links.
   */
  public function testReadsIgnoreStaleCachedCopy(): void {
    $assignments = $this->container->get('bb_track.assignments');
    $project_id = (int) $this->project->id();
    $assignments->activeAccounts($project_id);
    // Another request changed the row after this copy was read.
    $this->container->get('database')->update('bb_track_account')
      ->fields(['name' => 'Renamed elsewhere'])
      ->condition('id', $this->accountId)
      ->execute();
    self::assertSame('Renamed elsewhere', (string) $assignments->activeAccounts($project_id)[$this->accountId]->label());
  }

  /**
   * The ticket's linked account beats its ancestor's, which beats the default.
   */
  public function testTicketBeatsAncestorBeatsProject(): void {
    [$epic, $child] = $this->epicAndChild();
    $project_id = (int) $this->project->id();
    self::assertSame($this->accountId, $this->assignments()->assignment($project_id, (int) $child->id())['id']);
    self::assertSame([$this->accountId, NULL], $this->resolved($project_id, (int) $child->id()));
    $epic_account = $this->linkedAccount($epic, 'Epic work');
    self::assertSame((int) $epic_account->id(), $this->assignments()->assignment($project_id, (int) $child->id())['id']);
    self::assertSame([(int) $epic_account->id(), (int) $epic->id()], $this->resolved($project_id, (int) $child->id()));
    self::assertSame($this->accountId, $this->assignments()->assignment($project_id, NULL)['id']);
    $own_account = $this->linkedAccount($child, 'Child own work');
    self::assertSame((int) $own_account->id(), $this->assignments()->assignment($project_id, (int) $child->id())['id']);
    self::assertSame([(int) $own_account->id(), (int) $child->id()], $this->resolved($project_id, (int) $child->id()));
    self::assertSame((int) $epic_account->id(), $this->assignments()->assignment($project_id, (int) $epic->id())['id']);
  }

  /**
   * One account can be linked by several tickets; each unlinks on its own.
   */
  public function testSharedAccountLinksAndUnlinksPerTicket(): void {
    [$epic, $child] = $this->epicAndChild();
    $shared = $this->linkedAccount($epic, 'Shared work');
    $this->assignments()->linkTicket((int) $child->id(), (int) $shared->id(), 0);
    self::assertSame([(int) $epic->id(), (int) $child->id()], WorkAssignments::linkedTickets($this->reload($shared)));
    $this->assignments()->linkTicket((int) $epic->id(), NULL, (int) $shared->id());
    $reloaded = $this->reload($shared);
    self::assertSame([(int) $child->id()], WorkAssignments::linkedTickets($reloaded));
    self::assertTrue((bool) $reloaded->get('active')->value);
    self::assertSame('Shared work', (string) $reloaded->label());
    self::assertSame($this->accountId, $this->assignments()->assignment((int) $this->project->id(), (int) $epic->id())['id']);
    self::assertSame((int) $shared->id(), $this->assignments()->assignment((int) $this->project->id(), (int) $child->id())['id']);
  }

  /**
   * Relinking moves the ticket; a stale or a default target writes nothing.
   */
  public function testLinkTicketMovesAndRejectsStaleOrDefault(): void {
    [$epic] = $this->epicAndChild();
    $first = $this->linkedAccount($epic, 'First');
    $second = $this->unlinkedAccount('Second');
    $this->assignments()->linkTicket((int) $epic->id(), (int) $second->id(), (int) $first->id());
    self::assertSame([], WorkAssignments::linkedTickets($this->reload($first)));
    self::assertSame([(int) $epic->id()], WorkAssignments::linkedTickets($this->reload($second)));
    try {
      // Shown as linked to $first, which is no longer true.
      $this->assignments()->linkTicket((int) $epic->id(), NULL, (int) $first->id());
      self::fail('A stale link change was accepted.');
    }
    catch (\DomainException $error) {
      self::assertStringContainsString('changed elsewhere', $error->getMessage());
    }
    try {
      $this->assignments()->linkTicket((int) $epic->id(), $this->accountId, (int) $second->id());
      self::fail('The project default was linked to a ticket.');
    }
    catch (\DomainException $error) {
      self::assertSame('The project default cannot be linked to tickets.', $error->getMessage());
    }
    self::assertSame([(int) $epic->id()], WorkAssignments::linkedTickets($this->reload($second)));
  }

  /**
   * Archived accounts are skipped; their tickets inherit, history stays.
   */
  public function testArchivedAccountsAreSkippedAndReplaceable(): void {
    [$epic, $child] = $this->epicAndChild();
    $epic_account = $this->linkedAccount($epic, 'Epic work');
    $entry = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-07',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'Historical',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $this->project->id(),
      'ticket_id' => $child->id(),
    ]);
    $entry->save();
    self::assertEquals($epic_account->id(), $entry->get('account_id')->target_id);
    $this->archive($epic_account);
    self::assertSame($this->accountId, $this->assignments()->assignment((int) $this->project->id(), (int) $child->id())['id']);
    $replacement = $this->linkedAccount($epic, 'Epic work, renegotiated');
    self::assertSame((int) $replacement->id(), $this->assignments()->assignment((int) $this->project->id(), (int) $child->id())['id']);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache();
    $stored = $storage->load($entry->id());
    assert($stored instanceof Worklog);
    $stored->set('description', 'Historical, corrected')->save();
    $storage->resetCache();
    $corrected = $storage->load($entry->id());
    assert($corrected instanceof Worklog);
    self::assertEquals($epic_account->id(), $corrected->get('account_id')->target_id);
  }

  /**
   * One default, one link per ticket, and a linked account is never default.
   */
  public function testDefaultAndLinksAreUnique(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_account');
    $project_id = $this->project->id();
    $this->assertRejected(fn () => $storage->create([
      'name' => 'Second default',
      'project_id' => $project_id,
      'is_default' => TRUE,
    ])->save(), 'This project already has a default billing account.');
    [$epic] = $this->epicAndChild();
    $this->linkedAccount($epic, 'Epic work');
    // Direct entity writes (recipe imports) pass the same content check.
    $this->assertRejected(fn () => $storage->create([
      'name' => 'Imported epic work',
      'project_id' => $project_id,
      'tickets' => [$epic->id()],
    ])->save(), 'This ticket is already linked to another billing account.');
    $linked_default = $this->reload($this->assignments()->defaultAccount((int) $project_id));
    $linked_default->set('tickets', [$epic->id()]);
    $this->assertRejected(fn () => $linked_default->save(), 'The project default cannot be linked to tickets.');
    $this->assertRejected(fn () => $this->assignments()->saveAccount((int) $project_id, [
      'name' => 'Project work',
      'active' => FALSE,
    ], $this->accountId), 'Make another billing account the default before archiving this one.');
  }

  /**
   * Make default moves the flag; a linked account cannot take it.
   */
  public function testMakeDefault(): void {
    $project_id = (int) $this->project->id();
    $next = $this->unlinkedAccount('Next default');
    $this->assignments()->makeDefault($project_id, (int) $next->id());
    self::assertSame((int) $next->id(), (int) $this->assignments()->defaultAccount($project_id)->id());
    $loaded = $this->container->get('entity_type.manager')->getStorage('bb_track_account')->load($this->accountId);
    assert($loaded instanceof Account);
    self::assertFalse((bool) $this->reload($loaded)->get('is_default')->value);
    self::assertSame((int) $next->id(), $this->assignments()->assignment($project_id, NULL)['id']);
    [$epic] = $this->epicAndChild();
    $linked = $this->linkedAccount($epic, 'Epic work');
    $this->assertRejected(fn () => $this->assignments()->makeDefault($project_id, (int) $linked->id()), 'The project default cannot be linked to tickets.');
    self::assertSame((int) $next->id(), (int) $this->assignments()->defaultAccount($project_id)->id());
  }

  /**
   * Direct writes are validated on content, not on the caller.
   */
  public function testDirectWriteValidatesContent(): void {
    $types = $this->container->get('entity_type.manager');
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $other = $types->getStorage('bb_project')->create([
      'name' => 'Imported',
      'key' => 'IMP',
      'group_id' => $this->project->get('group_id')->target_id,
      'owner_user_id' => $this->project->get('owner_user_id')->target_id,
    ]);
    $other->save();
    $storage = $types->getStorage('bb_track_account');
    $imported = $storage->create([
      'name' => 'Imported billing',
      'project_id' => $other->id(),
    ]);
    $imported->save();
    self::assertSame((int) $this->assignments()->defaultAccount((int) $other->id())->id(), $this->assignments()->resolveAccountId((int) $other->id(), NULL));
    [$epic] = $this->epicAndChild();
    $foreign = $storage->create([
      'name' => 'Ticket of another project',
      'project_id' => $other->id(),
      'tickets' => [$epic->id()],
    ]);
    $this->expectException(\DomainException::class);
    $this->expectExceptionMessage('belongs to another project');
    $foreign->save();
  }

  /**
   * No active account anywhere fails resolution and the worklog write.
   */
  public function testMissingAccountThrowsAndWritesNothing(): void {
    [, $child] = $this->epicAndChild();
    // A project without a default exists only through legacy data or a
    // direct write that clears the flag together with archiving.
    $default = $this->reload($this->assignments()->defaultAccount((int) $this->project->id()));
    $default->set('is_default', FALSE)->set('active', FALSE)->save();
    try {
      $this->assignments()->assignment((int) $this->project->id(), (int) $child->id());
      self::fail('Resolution succeeded without an active account.');
    }
    catch (\DomainException $error) {
      self::assertSame('No billing account is configured for this project or ticket. Ask a project maintainer to set one.', $error->getMessage());
    }
    self::assertSame([NULL, NULL], $this->assignments()->resolution((int) $this->project->id(), (int) $child->id()));
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $entry = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-07',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'No account configured',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $this->project->id(),
      'ticket_id' => $child->id(),
    ]);
    try {
      $entry->save();
      self::fail('A worklog was written without a billing account.');
    }
    catch (\Throwable $error) {
      self::assertInstanceOf(\DomainException::class, $error);
      self::assertSame('No billing account is configured for this project or ticket. Ask a project maintainer to set one.', $error->getMessage());
    }
    self::assertSame([], $storage->getQuery()->accessCheck(FALSE)->execute());
  }

  /**
   * A billing account is archived, never deleted, not even by an admin.
   */
  public function testNoOneDeletesBillingAccount(): void {
    [$epic] = $this->epicAndChild();
    $account = $this->linkedAccount($epic, 'Kept');
    $admin = $this->createUser(['administer bakers'], 'billing-admin');
    self::assertInstanceOf(UserInterface::class, $admin);
    self::assertFalse($account->access('delete', $admin));
    $this->expectExceptionMessage('Billing accounts must be archived instead of deleted.');
    $account->delete();
  }

  /**
   * A project without logged time takes its billing accounts with it.
   */
  public function testProjectDeleteTakesItsBillingAccounts(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_account');
    $owned = fn() => $storage->getQuery()->accessCheck(FALSE)->condition('project_id', $this->project->id())->execute();
    self::assertNotEmpty($owned());
    $this->project->delete();
    self::assertSame([], $owned());
  }

  /**
   * Logged time keeps its ticket and project from being deleted.
   */
  public function testLoggedTimeBlocksTicketAndProjectDelete(): void {
    [$epic] = $this->epicAndChild();
    Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-07',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'Logged',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $this->project->id(),
      'ticket_id' => $epic->id(),
    ])->save();
    $etm = $this->container->get('entity_type.manager');
    foreach ([$epic, $this->project] as $blocked) {
      try {
        $blocked->delete();
        self::fail($blocked->getEntityTypeId() . ' with logged time was deleted.');
      }
      catch (EntityStorageException) {
      }
      $etm->getStorage($blocked->getEntityTypeId())->resetCache();
      self::assertNotNull($etm->getStorage($blocked->getEntityTypeId())->load($blocked->id()));
    }
  }

  /**
   * A linking account can still be archived after its ticket is gone.
   */
  public function testArchivableAfterTicketDeleted(): void {
    [$epic] = $this->epicAndChild();
    $account = $this->linkedAccount($epic, 'Epic work');
    $epic_id = $epic->id();
    $epic->delete();
    // The deleted ticket is detached; no dangling reference stays behind.
    self::assertNotContains($epic_id, array_column($this->reload($account)->get('tickets')->getValue(), 'target_id'));
    $this->archive($account);
    self::assertFalse((bool) $this->reload($account)->get('active')->value);
  }

  /**
   * A chosen account must be an active one of the entry's project.
   */
  public function testChosenAccountMustFitTheTarget(): void {
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => 'Other',
      'key' => 'OTH',
      'group_id' => $this->project->get('group_id')->target_id,
      'owner_user_id' => $this->project->get('owner_user_id')->target_id,
    ]);
    $other->save();
    $foreign = $this->assignments()->defaultAccount((int) $other->id());
    $this->expectException(\DomainException::class);
    $this->expectExceptionMessage('Billing account is unavailable or belongs to another project.');
    $this->assignments()->assignment((int) $this->project->id(), NULL, (int) $foreign->id());
  }

  /**
   * Moving an account re-checks its linked tickets' project.
   *
   * Only a direct entity save can reach this: `saveAccount()` already pins
   * an account to its stored project.
   */
  public function testMovingProjectRevalidatesUnchangedTicket(): void {
    [$epic] = $this->epicAndChild();
    $account = $this->linkedAccount($epic, 'Epic work');
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => 'Other',
      'key' => 'OTH2',
      'group_id' => $this->project->get('group_id')->target_id,
      'owner_user_id' => $this->project->get('owner_user_id')->target_id,
    ]);
    $other->save();
    $account = $this->reload($account);
    $account->set('project_id', $other->id());
    $this->expectException(\DomainException::class);
    $this->expectExceptionMessage('Ticket is unavailable or belongs to another project.');
    $account->save();
  }

  /**
   * Recording permission alone does not grant configuration authority.
   */
  public function testContributorDenied(): void {
    [$epic] = $this->epicAndChild();
    $other = $this->unlinkedAccount('Other work');
    $this->container->get('current_user')->setAccount($this->peer);
    self::assertTrue($this->project->access('view', $this->peer));
    self::assertFalse($this->project->access('update', $this->peer));
    $denied = 'You cannot configure billing accounts for this project.';
    $this->assertRejected(fn () => $this->assignments()->saveAccount((int) $this->project->id(), [
      'name' => 'Unauthorized',
    ]), $denied);
    $this->assertRejected(fn () => $this->assignments()->linkTicket((int) $epic->id(), (int) $other->id(), 0), $denied);
    $this->assertRejected(fn () => $this->assignments()->makeDefault((int) $this->project->id(), (int) $other->id()), $denied);
    self::assertSame([], WorkAssignments::linkedTickets($this->reload($other)));
    self::assertSame($this->accountId, (int) $this->assignments()->defaultAccount((int) $this->project->id())->id());
  }

  /**
   * External ID accepts empty, numeric-looking text and the 255 boundary.
   */
  public function testExternalIdBoundaries(): void {
    $project_id = (int) $this->project->id();
    $created = $this->assignments()->saveAccount($project_id, ['name' => 'No id']);
    self::assertSame('', (string) $this->reload($created)->get('external_id')->value);
    self::assertSame('', $this->assignments()->assignment($project_id, NULL, (int) $created->id())['external_id']);
    self::assertArrayNotHasKey('billing_type', $this->assignments()->assignment($project_id, NULL, (int) $created->id()));

    $zero = $this->assignments()->saveAccount($project_id, ['name' => 'Zero id', 'external_id' => '0']);
    self::assertSame('0', (string) $this->reload($zero)->get('external_id')->value);

    $leading = $this->assignments()->saveAccount($project_id, ['name' => 'Leading zero', 'external_id' => '00123']);
    self::assertSame('00123', (string) $this->reload($leading)->get('external_id')->value);
    self::assertSame('00123', $this->assignments()->assignment($project_id, NULL, (int) $leading->id())['external_id']);

    $max = str_repeat('x', 255);
    $boundary = $this->assignments()->saveAccount($project_id, ['name' => 'Max id', 'external_id' => $max]);
    self::assertSame($max, (string) $this->reload($boundary)->get('external_id')->value);

    // Input validation rejects with InvalidArgumentException, not the
    // guard's DomainException.
    try {
      $this->assignments()->saveAccount($project_id, ['name' => 'Too long', 'external_id' => $max . 'x']);
      self::fail('An external ID over 255 characters was accepted.');
    }
    catch (\InvalidArgumentException $error) {
      self::assertSame('External ID must be 255 characters or fewer.', $error->getMessage());
    }
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadByProperties(['name' => 'Too long']));

    $this->expectException(\InvalidArgumentException::class);
    $this->assignments()->saveAccount($project_id, ['name' => 'Wrong type', 'external_id' => ['not', 'a', 'string']]);
  }

  /**
   * Omitting external_id preserves its value; an explicit empty clears it.
   */
  public function testExternalIdOmittedPreservesExplicitEmptyClears(): void {
    $project_id = (int) $this->project->id();
    $account = $this->assignments()->saveAccount($project_id, ['name' => 'Harvest linked', 'external_id' => 'HARV-9']);
    $id = (int) $account->id();

    $this->assignments()->saveAccount($project_id, ['name' => 'Harvest linked'], $id);
    self::assertSame('HARV-9', (string) $this->reload($account)->get('external_id')->value);

    $this->assignments()->saveAccount($project_id, ['name' => 'Harvest linked', 'external_id' => ''], $id);
    self::assertSame('', (string) $this->reload($account)->get('external_id')->value);
  }

  /**
   * A field saveAccount() does not write is rejected as unknown.
   */
  public function testUnknownFieldRejected(): void {
    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('Unknown billing-account field.');
    $this->assignments()->saveAccount((int) $this->project->id(), [
      'name' => 'Legacy',
      'is_default' => TRUE,
    ]);
  }

  /**
   * New accounts are Time & Materials without a budget unless told otherwise.
   */
  public function testNewAccountsDefaultToTimeAndMaterialsWithoutBudget(): void {
    $types = $this->container->get('entity_type.manager');
    $project = $types->getStorage('bb_project')->create([
      'name' => 'Fresh',
      'key' => 'FRESH',
      'group_id' => $this->project->get('group_id')->target_id,
      'owner_user_id' => $this->project->get('owner_user_id')->target_id,
    ]);
    $project->save();
    $default = $this->assignments()->defaultAccount((int) $project->id());
    $bare = $types->getStorage('bb_track_account')->create(['name' => 'Bare', 'project_id' => $project->id()]);
    $bare->save();
    assert($bare instanceof Account);
    foreach ([$default, $bare] as $account) {
      self::assertSame(['time_material', 'none', NULL, FALSE, NULL, NULL], $this->terms($this->reload($account)));
    }
  }

  /**
   * A direct save with terms foreign to the type is rejected, not stored.
   */
  public function testDirectSaveRejectsForeignTerms(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_account');
    $account = $storage->create([
      'name' => 'Internal with a rate',
      'project_id' => $this->project->id(),
      'billing_type' => 'non_billable',
      'hourly_rate' => '90',
    ]);
    try {
      $account->save();
      self::fail('A Non-Billable account with a rate was saved.');
    }
    catch (\Exception $error) {
      self::assertInstanceOf(\InvalidArgumentException::class, $error);
      self::assertSame('Non-Billable accounts carry no hourly rate.', $error->getMessage());
    }
    self::assertSame([], $storage->loadByProperties(['name' => 'Internal with a rate']));
  }

  /**
   * A posted type writes all six terms; archiving leaves them alone.
   */
  public function testSaveAccountWritesTermsAsSetAndArchivePreserves(): void {
    $project_id = (int) $this->project->id();
    $fixed = [
      'name' => 'Fixed',
      'billing_type' => 'fixed_fee',
      'fixed_fee' => '1000',
      'hourly_rate' => '80',
      'budget_kind' => 'hours',
      'budget_value' => '10',
      'budget_resets_monthly' => TRUE,
    ];
    $id = (int) $this->assignments()->saveAccount($project_id, $fixed)->id();
    $account = $this->assignments()->saveAccount($project_id, ['name' => 'Fixed', 'billing_type' => 'non_billable'], $id);
    self::assertSame(['non_billable', 'none', NULL, FALSE, NULL, NULL], $this->terms($this->reload($account)));

    $this->assignments()->saveAccount($project_id, $fixed, $id);
    $this->assignments()->saveAccount($project_id, ['name' => 'Fixed', 'external_id' => '', 'active' => FALSE], $id);
    $archived = $this->reload($account);
    $terms = $this->terms($archived);
    self::assertSame(['fixed_fee', 'hours', TRUE], [$terms[0], $terms[1], $terms[3]]);
    self::assertSame([10.0, 1000.0, 80.0], [(float) $terms[2], (float) $terms[4], (float) $terms[5]]);
  }

  /**
   * Terms are type-checked at the application boundary.
   */
  public function testSaveAccountRejectsCoercedTerms(): void {
    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('Billing account amounts must be numbers.');
    $this->assignments()->saveAccount((int) $this->project->id(), [
      'name' => 'Coerced',
      'billing_type' => 'time_material',
      'hourly_rate' => 90,
    ]);
  }

  /**
   * The six stored billing terms, in AccountValidation::TERMS order.
   *
   * @return list<mixed>
   *   Type, budget kind, budget value, monthly reset, fixed fee, rate.
   */
  private function terms(Account $account): array {
    return [
      $account->get('billing_type')->value,
      $account->get('budget_kind')->value,
      $account->get('budget_value')->value,
      (bool) $account->get('budget_resets_monthly')->value,
      $account->get('fixed_fee')->value,
      $account->get('hourly_rate')->value,
    ];
  }

  /**
   * Many tickets resolve exactly as each one does on its own.
   */
  public function testResolutionsMatchResolutionForEveryTicket(): void {
    [$linked, $child] = $this->epicAndChild();
    [$unlinked, $archived] = $this->epicAndChild();
    $account = $this->linkedAccount($linked, 'Linked work');
    $this->archive($this->linkedAccount($archived, 'Archived work'));
    $project_id = (int) $this->project->id();
    $tickets = [$linked, $child, $unlinked, $archived];
    $ids = array_map(static fn(ContentEntityInterface $ticket): int => (int) $ticket->id(), $tickets);
    $resolved = array_map(static fn(?Account $account): ?int => $account ? (int) $account->id() : NULL, $this->assignments()->resolutions($project_id, $ids));
    $expected = [(int) $account->id(), (int) $account->id(), $this->accountId, $this->accountId];
    self::assertSame(array_combine($ids, $expected), $resolved);
    foreach ($ids as $id) {
      self::assertSame($this->resolved($project_id, $id)[0], $resolved[$id]);
    }
  }

  /**
   * Many tickets load the project's accounts only once.
   */
  public function testResolutionsLoadTheAccountsOnce(): void {
    [$linked, $child] = $this->epicAndChild();
    $this->linkedAccount($linked, 'Linked work');
    $project_id = (int) $this->project->id();
    $once = $this->accountQueries(fn() => $this->assignments()->activeAccounts($project_id));
    $ticket_ids = [(int) $linked->id(), (int) $child->id()];
    $resolved = $this->accountQueries(fn() => $this->assignments()->resolutions($project_id, $ticket_ids));
    self::assertSame($once, $resolved);
  }

  /**
   * The number of billing account queries an operation issues.
   */
  private function accountQueries(callable $operation): int {
    Database::startLog('account_queries');
    $operation();
    $log = Database::getLog('account_queries');
    Database::getConnection()->getLogger()?->clear('account_queries');
    return count(array_filter($log, static fn(array $entry): bool => str_contains((string) $entry['query'], 'bb_track_account')));
  }

  /**
   * The assignments service.
   */
  private function assignments(): WorkAssignments {
    $assignments = $this->container->get('bb_track.assignments');
    assert($assignments instanceof WorkAssignments);
    return $assignments;
  }

  /**
   * A new active account of the fixture project, linked by no ticket.
   */
  private function unlinkedAccount(string $name): Account {
    return $this->assignments()->saveAccount((int) $this->project->id(), [
      'name' => $name,
    ]);
  }

  /**
   * A new active account of the fixture project, linked by the ticket.
   */
  private function linkedAccount(ContentEntityInterface $ticket, string $name): Account {
    $account = $this->unlinkedAccount($name);
    $shown = $this->assignments()->linkedAccount((int) $this->project->id(), (int) $ticket->id());
    $this->assignments()->linkTicket((int) $ticket->id(), (int) $account->id(), (int) $shown?->id());
    return $account;
  }

  /**
   * Archives an account through the configuration operation.
   */
  private function archive(Account $account): void {
    $this->assignments()->saveAccount((int) $this->project->id(), [
      'name' => (string) $account->label(),
      'active' => FALSE,
    ], (int) $account->id());
  }

  /**
   * The account as stored now.
   */
  private function reload(?Account $account): Account {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_account');
    $reloaded = $storage->loadUnchanged($account?->id());
    assert($reloaded instanceof Account);
    return $reloaded;
  }

  /**
   * The resolved account id and its linking ticket id.
   *
   * @return array{0: ?int, 1: ?int}
   *   Ids.
   */
  private function resolved(int $project_id, ?int $ticket_id): array {
    [$account, $source] = $this->assignments()->resolution($project_id, $ticket_id);
    return [$account ? (int) $account->id() : NULL, $source];
  }

  /**
   * Asserts the operation fails with exactly this domain message.
   */
  private function assertRejected(callable $operation, string $message): void {
    try {
      $operation();
      self::fail('Expected rejection: ' . $message);
    }
    catch (\DomainException $error) {
      self::assertSame($message, $error->getMessage());
    }
  }

  /**
   * An epic and a child ticket in the fixture project.
   *
   * @return array{0: \Drupal\Core\Entity\ContentEntityInterface, 1: \Drupal\Core\Entity\ContentEntityInterface}
   *   The epic, then the child.
   */
  private function epicAndChild(): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $epic = $storage->create([
      'title' => 'Epic',
      'project_id' => $this->project->id(),
      'workflow' => 'bb_work',
    ]);
    $epic->save();
    $child = $storage->create([
      'title' => 'Child',
      'project_id' => $this->project->id(),
      'parent_id' => $epic->id(),
      'workflow' => 'bb_work',
    ]);
    $child->save();
    assert($epic instanceof ContentEntityInterface);
    assert($child instanceof ContentEntityInterface);
    return [$epic, $child];
  }

}
