<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Tests\bb_track\Kernel\LegacyWorklogFixture;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_track\Entity\Worklog;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * An owner's agent corrects a recorded or proposed entry under the form rules.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogUpdateToolTest extends TimeToolTestBase {

  /**
   * Each field changes; omitted fields stay; the new version is returned.
   */
  public function testOwnerEditsEveryField(): void {
    $entry = $this->recorded('own');
    $ticket = $this->ticket('Fix it');
    $listed = $this->outputs($this->runTool('bakers_worklog_list', ['from' => '2026-08-01', 'to' => '2026-08-09']))['data'][0];
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $listed['version'],
      'work_date' => '2026-08-04',
      'duration_seconds' => 1800,
      'description' => '  Pairing  ',
      'ticket' => $ticket->uuid(),
    ]));
    $saved = $this->reload($entry);
    self::assertSame($entry->uuid(), $row['id']);
    self::assertSame($saved->version(), $row['version']);
    self::assertNotSame($listed['version'], $row['version']);
    self::assertSame('2026-08-04', $row['work_date']);
    self::assertSame(1800, $row['duration_seconds']);
    self::assertSame('Pairing', $row['description']);
    self::assertSame($ticket->uuid(), $row['ticket_id']);
    self::assertSame($this->project->uuid(), $row['project_id']);
    self::assertSame($listed['account'], $row['account']);
    self::assertSame('recorded', $row['state']);
    self::assertFalse($row['omitted']);
    self::assertSame($entry->get('derivation')->value, $saved->get('derivation')->value);

    // Only the description changes; everything else stays.
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $row['version'],
      'description' => 'Pairing on the fix',
    ]));
    self::assertSame(['2026-08-04', 1800, 'Pairing on the fix', $ticket->uuid()], [$row['work_date'], $row['duration_seconds'], $row['description'], $row['ticket_id']]);

    // A chosen account of the project.
    $other = $this->container->get('bb_track.assignments')->saveAccount((int) $this->project->id(), ['name' => 'Support']);
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $row['version'],
      'account' => $other->uuid(),
    ]));
    self::assertSame($other->uuid(), $row['account']);
  }

  /**
   * A new target clears the ticket and the account unless they are given.
   */
  public function testTargetChangeClearsDependentFields(): void {
    $ticket = $this->ticket('Fix it');
    $support = $this->container->get('bb_track.assignments')->saveAccount((int) $this->project->id(), ['name' => 'Support']);
    $entry = $this->recorded('own');
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $entry->version(),
      'ticket' => $ticket->uuid(),
      'account' => $support->uuid(),
    ]));
    self::assertSame($support->uuid(), $row['account']);

    // Clearing the ticket also falls back to the default account.
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $row['version'],
      'ticket' => '',
    ]));
    self::assertNull($row['ticket_id']);
    self::assertSame($this->accountUuid($this->accountId), $row['account']);

    // A new project without ticket or account uses that project's default.
    $other = $this->project('Other', 'OTHER');
    $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $row['version'],
      'ticket' => $ticket->uuid(),
    ]));
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $this->reload($entry)->version(),
      'project' => $other->uuid(),
    ]));
    self::assertSame($other->uuid(), $row['project_id']);
    self::assertNull($row['ticket_id']);
    $default = $this->container->get('bb_track.assignments')->defaultAccount((int) $other->id());
    self::assertSame($default->uuid(), $row['account']);

    // An empty account returns to the default.
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $row['version'],
      'project' => $this->project->uuid(),
      'account' => $support->uuid(),
    ]));
    self::assertSame($support->uuid(), $row['account']);
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $row['version'],
      'account' => '',
    ]));
    self::assertSame($this->accountUuid($this->accountId), $row['account']);
  }

  /**
   * A proposed entry stays proposed in its proposal.
   */
  public function testProposedEntryStaysInItsProposal(): void {
    $out = $this->outputs($this->runTool('bakers_worklog_propose', [
      'project' => $this->project->uuid(),
      'entries' => [$this->entry('proposal')],
    ]));
    $entry = $this->container->get('entity.repository')->loadEntityByUuid('bb_track_worklog', $out['worklogs'][0]);
    assert($entry instanceof Worklog);
    $row = $this->outputs($this->runTool('bakers_worklog_update', [
      'worklog' => $entry->uuid(),
      'version' => $entry->version(),
      'duration_seconds' => 600,
    ]));
    self::assertSame('proposed', $row['state']);
    self::assertSame($out['submission'], $row['submission_id']);
    self::assertSame(600, $row['duration_seconds']);
  }

  /**
   * Every refusal names its reason and leaves the entry unchanged.
   */
  public function testRefusalsLeaveTheEntryUnchanged(): void {
    $entry = $this->recorded('own');
    $this->container->get('current_user')->setAccount($this->peer);
    $foreign = $this->recorded('peer');
    $this->container->get('current_user')->setAccount($this->employee);
    $approved = $this->legacy('approved');
    $voided = $this->recorded('voided');
    $this->container->get('database')->update('bb_track_worklog')->fields(['voided' => 1])->condition('id', $voided->id())->execute();
    $voided = $this->reload($voided);
    $rule = 'only its owner may, while it is recorded or proposed, with record own worklog in its project’s workspace';
    $cases = [
      'unknown uuid' => [$entry, ['worklog' => $this->container->get('uuid')->generate()], 'Worklog unavailable.'],
      'invalid uuid' => [$entry, ['worklog' => 'nope'], 'Worklog unavailable.'],
      'foreign unreadable' => [$foreign, [], 'Worklog unavailable.'],
      'voided' => [$voided, [], 'Worklog unavailable.'],
      'approved' => [$approved, [], $rule],
      'stale version' => [$entry, ['version' => 'stale'], 'This entry changed. Refresh before saving.'],
      'unknown project' => [$entry, ['project' => $this->container->get('uuid')->generate()], 'Assignment unavailable.'],
      'invalid date' => [$entry, ['work_date' => '2026-02-30'], 'Use a valid civil date.'],
      'invalid duration' => [$entry, ['duration_seconds' => 61], 'Duration must be whole minutes'],
      'empty description' => [$entry, ['description' => '  '], 'Description'],
      'nothing to update' => [$entry, ['description' => NULL], 'Nothing to update.'],
      'owner' => [$entry, ['owner' => $this->peer->uuid()], 'owner'],
      'state' => [$entry, ['state' => 'approved'], 'state'],
      'submission' => [$entry, ['submission' => $this->container->get('uuid')->generate()], 'submission'],
      'source' => [$entry, ['source_key' => 'forged'], 'source_key'],
    ];
    foreach ($cases as $case => [$target, $override, $message]) {
      $before = $this->stored($target);
      $result = $this->runTool('bakers_worklog_update', $override + [
        'worklog' => $target->uuid(),
        'version' => $target->version(),
        'description' => 'Changed',
      ]);
      self::assertFalse($result->isSuccess(), $case);
      self::assertStringContainsString($message, (string) $result->getMessage(), $case);
      self::assertSame($before, $this->stored($target), $case);
    }

    // Recording rights come from the rank in the project's workspace only.
    $ranked = $this->createUser(['view bb_project', 'view bb_ticket', 'view bb_group'], 'ranked');
    $this->addMembership($this->fixtureWorkspace(), $ranked, ['lead']);
    $this->container->get('current_user')->setAccount($ranked);
    $own = $this->recorded('ranked');
    $elsewhere = $this->foreignWorkspaceProject();
    self::assertTrue($elsewhere->access('view', $ranked));
    $result = $this->runTool('bakers_worklog_update', ['worklog' => $own->uuid(), 'version' => $own->version(), 'project' => $elsewhere->uuid()]);
    $this->assertFailure($result, 'Project is unavailable for recording.');
    self::assertSame($own->version(), $this->stored($own));

    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    self::assertFalse($this->runTool('bakers_worklog_update', ['worklog' => $entry->uuid(), 'version' => $entry->version(), 'description' => 'Changed'])->isSuccess());
    self::assertSame('Meeting', $this->reload($entry)->get('description')->value);
  }

  /**
   * A team lead may read a member's entry; the refusal names roles, not people.
   */
  public function testTeamLeadMayNotChangeMemberEntry(): void {
    $this->container->get('current_user')->setAccount($this->peer);
    $foreign = $this->recorded('peer');
    $this->addMembership($this->project->get('teams')->entity, $this->employee, ['lead']);
    $this->container->get('current_user')->setAccount($this->employee);
    self::assertTrue($foreign->access('view', $this->employee));
    $result = $this->runTool('bakers_worklog_update', ['worklog' => $foreign->uuid(), 'version' => $foreign->version(), 'description' => 'Changed']);
    $this->assertFailure($result, 'You may not change this worklog: only its owner may, while it is recorded or proposed, with record own worklog in its project’s workspace.');
    self::assertStringNotContainsString('peer', (string) $result->getMessage());
    self::assertSame($foreign->version(), $this->stored($foreign));
  }

  /**
   * A recorded own entry with source provenance.
   */
  private function recorded(string $key): Worklog {
    return $this->container->get('bb_track.activity_input')->input($this->activity($key));
  }

  /**
   * An own entry in a state the tools may not reach.
   */
  private function legacy(string $state): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-08-03',
      'duration_seconds' => 3600,
      'description' => 'Approved work',
      'state' => $state,
      'project_id' => $this->project->id(),
    ]);
    assert($entry instanceof Worklog);
    LegacyWorklogFixture::save($entry);
    return $this->reload($entry);
  }

  /**
   * The stored entry, fresh from the database.
   */
  private function reload(Worklog $entry): Worklog {
    $saved = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->loadUnchanged($entry->id());
    assert($saved instanceof Worklog);
    return $saved;
  }

  /**
   * The stored entry's lock token, or NULL when it no longer exists.
   */
  private function stored(Worklog $entry): ?string {
    $saved = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->loadUnchanged($entry->id());
    return $saved instanceof Worklog ? $saved->version() : NULL;
  }

  /**
   * A ticket of the fixture project.
   */
  private function ticket(string $title): ContentEntityInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => $title,
      'project_id' => $this->project->id(),
      'workflow' => 'bb_work',
    ]);
    $ticket->save();
    assert($ticket instanceof ContentEntityInterface);
    return $ticket;
  }

  /**
   * A project of the fixture group.
   */
  private function project(string $name, string $key): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => $name,
      'key' => $key,
      'group_id' => $this->project->get('group_id')->target_id,
    ]);
    assert($project instanceof BbProjectInterface);
    $project->save();
    return $project;
  }

  /**
   * A project the employee may view but not record on.
   */
  private function foreignWorkspaceProject(): BbProjectInterface {
    $types = $this->container->get('entity_type.manager');
    $workspace = $types->getStorage('bb_workspace')->create(['name' => 'Elsewhere', 'slug' => 'elsewhere', 'owner_user_id' => $this->peer->id()]);
    $workspace->save();
    $group = $types->getStorage('bb_group')->create(['name' => 'Other customer', 'workspace_id' => $workspace->id(), 'owner_user_id' => $this->peer->id()]);
    $group->save();
    $project = $types->getStorage('bb_project')->create(['name' => 'Elsewhere', 'key' => 'ELSE', 'group_id' => $group->id(), 'owner_user_id' => $this->peer->id()]);
    assert($project instanceof BbProjectInterface);
    $project->save();
    return $project;
  }

  /**
   * A billing account's UUID.
   */
  private function accountUuid(int $id): string {
    return $this->container->get('entity_type.manager')->getStorage('bb_track_account')->load($id)->uuid();
  }

  /**
   * A propose entry: the activity fields with UUID references.
   *
   * @return array<string, mixed>
   *   The entry.
   */
  private function entry(string $key): array {
    $entry = $this->activity($key);
    unset($entry['project_id']);
    return $entry;
  }

}
